import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { JOB_QUEUE, type JobQueue } from "../../infra/queue/queue.module";
import { logger } from "../../shared/logging/logger";

export interface RsvpDigestSweepResult {
  readonly digestsQueued: number;
}

/**
 * `P4-08` — Daily aggregated RSVP digest alternative (`docs/PLAN/13` § Preferences).
 *
 * For wedding invitation owners who prefer not to receive an email per guest,
 * aggregates all RSVP responses received in the past 24 hours into a single
 * daily morning summary (scheduled at 09:00 WIB via `rsvp_daily_digest`).
 */
@Injectable()
export class RsvpDigestService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async sendDailyDigests(
    now: Date = new Date(),
  ): Promise<RsvpDigestSweepResult> {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dateFormatted = now.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    });

    // Query published/live invitations whose owners opted into RSVP emails AND digest mode,
    // and which have at least 1 response within the past 24h.
    const eligibleQuery = await this.db.execute<{
      invitation_id: string;
      internal_name: string | null;
      recipient_email: string;
      recipient_name: string;
      total_responses: string | number;
      attending_count: string | number;
      not_attending_count: string | number;
      maybe_count: string | number;
    }>(sql`
      SELECT
        i.id as invitation_id,
        i.internal_name,
        u.email as recipient_email,
        u.full_name as recipient_name,
        COUNT(g.id) as total_responses,
        COUNT(CASE WHEN g.attendance_status = 'attending' THEN 1 END) as attending_count,
        COUNT(CASE WHEN g.attendance_status = 'not_attending' THEN 1 END) as not_attending_count,
        COUNT(CASE WHEN g.attendance_status = 'maybe' THEN 1 END) as maybe_count
      FROM invitations i
      JOIN users u ON u.id = i.owner_id
      JOIN user_notification_preferences p ON p.user_id = u.id
      JOIN invitation_guests g ON g.invitation_id = i.id
      WHERE u.deleted_at IS NULL
        AND i.deleted_at IS NULL
        AND p.rsvp_email = true
        AND p.rsvp_digest = true
        AND g.created_at >= ${since.toISOString()}
      GROUP BY i.id, i.internal_name, u.email, u.full_name
    `);

    const rows = eligibleQuery.rows;
    let digestsQueued = 0;

    for (const row of rows) {
      try {
        const invitationId = row.invitation_id;
        const totalResponsesToday = Number(row.total_responses);
        if (totalResponsesToday === 0) continue;

        // Fetch up to 10 most recent guests in the 24h window
        const recentGuestsRes = await this.db.execute<{
          guest_name: string;
          attendance_status: "attending" | "not_attending" | "maybe";
          guest_count: number;
        }>(sql`
          SELECT guest_name, attendance_status, guest_count
          FROM invitation_guests
          WHERE invitation_id = ${invitationId}
            AND created_at >= ${since.toISOString()}
          ORDER BY created_at DESC
          LIMIT 10
        `);

        const recentGuests = recentGuestsRes.rows.map((g) => ({
          guestName: g.guest_name,
          attendanceStatus: g.attendance_status,
          guestCount: Number(g.guest_count),
        }));

        const idempotencyKey = `rsvp.digest:${invitationId}:${dateFormatted}`;

        await this.queue.enqueue(
          "general",
          "notification.send",
          {
            template: "rsvp_daily_digest",
            invitationId,
            recipientEmail: row.recipient_email,
            recipientName: row.recipient_name,
            invitationTitle: row.internal_name ?? "Undangan Pernikahan",
            dateFormatted,
            totalResponsesToday,
            attendingCount: Number(row.attending_count),
            notAttendingCount: Number(row.not_attending_count),
            maybeCount: Number(row.maybe_count),
            recentGuests,
          },
          {
            idempotencyKey,
            relatedId: invitationId,
          },
        );

        digestsQueued++;
        logger.info(
          {
            context: {
              invitation_id: invitationId,
              email: row.recipient_email,
              total: totalResponsesToday,
            },
          },
          "enqueued daily RSVP digest email",
        );
      } catch (err) {
        logger.error(
          {
            err,
            context: {
              invitation_id: row.invitation_id,
            },
          },
          "failed to enqueue RSVP daily digest",
        );
      }
    }

    return { digestsQueued };
  }
}
