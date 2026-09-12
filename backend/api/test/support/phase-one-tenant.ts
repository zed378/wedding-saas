import type { Pool } from "pg";

import {
  createTestInvitation,
  createTestTemplateVersion,
  createTestUser,
  type TestInvitation,
  type TestTemplateVersion,
  type TestUser,
} from "./factories";
import { signAccessToken } from "../../src/modules/auth/tokens/access-token.service";

/**
 * P1-25 — one tenant with **every** Phase 1 resource type on it, twice over, plus a
 * bearer token.
 *
 * `createTwoTenants` gives a user and an empty invitation, which is all a service-level
 * IDOR test needs. The HTTP sweep needs more:
 *
 * **Every sub-resource has to exist.** An endpoint that answers 404 because the child row
 * is not there proves nothing about ownership.
 *
 * **Each user needs a second invitation.** Cross-tenant is not the only way a child id
 * can be the wrong one — a user with two weddings can address the first invitation and
 * the second one's event, and a repository that constrains only the owner would happily
 * edit it. Two users cannot catch that; one user with two invitations can. `P1-19`'s
 * record makes the same point about media: "a photo from the user's *other* wedding is
 * still the wrong photo."
 *
 * The distinctive strings are deliberate. Each is unique to this tenant and is passed to
 * the sweep as a `mustNotContain` marker — a 404 whose body still carries the venue name
 * is a leak with a misleading status code, and only a value search finds it.
 */

/** One invitation and the whole aggregate hanging off it. */
export interface TenantInvitation {
  readonly invitation: TestInvitation;
  readonly eventId: string;
  readonly bankAccountId: string;
  readonly mediaId: string;
  /**
   * A second `ready` photo on the same invitation, attached to nothing.
   *
   * `POST /gallery` refuses a media id that is already in the gallery, so the attach case
   * needs a spare — without one, the owner's own request is refused for a reason that has
   * nothing to do with ownership and the positive control proves nothing.
   */
  readonly spareMediaId: string;
  readonly photoId: string;
  readonly markers: readonly string[];
}

export interface PhaseOneTenant extends TenantInvitation {
  readonly user: TestUser;
  readonly token: string;
  readonly template: TestTemplateVersion;
  /** A second published template, so `change-template` has somewhere to go. */
  readonly otherTemplate: TestTemplateVersion;
  /** The same user's OTHER wedding. Same owner, different invitation. */
  readonly second: TenantInvitation;
}

export async function createPhaseOneTenant(
  pool: Pool,
  signingKey: string,
  name: string,
): Promise<PhaseOneTenant> {
  const user = await createTestUser(pool, {
    fullName: name,
    email: `${name.toLowerCase()}-${unique()}@example.test`,
  });

  const template = await createTestTemplateVersion(pool);
  const otherTemplate = await createTestTemplateVersion(pool);

  const first = await createInvitationWithChildren(pool, user, template, name);
  const second = await createInvitationWithChildren(
    pool,
    user,
    template,
    `${name} Second`,
  );

  const token = await signAccessToken(signingKey, {
    userId: user.id,
    role: "user",
    emailVerified: true,
  });

  return { user, token, template, otherTemplate, second, ...first };
}

const unique = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function createInvitationWithChildren(
  pool: Pool,
  user: TestUser,
  template: TestTemplateVersion,
  name: string,
): Promise<TenantInvitation> {
  const invitation = await createTestInvitation(pool, {
    owner: user,
    template,
    internalName: `${name}'s wedding`,
  });

  const venue = `${name} Grand Ballroom`;
  const { rows: events } = await pool.query<{ id: string }>(
    `INSERT INTO invitation_events
       (invitation_id, type, title, event_date, start_time, venue_name, address)
     VALUES ($1, 'akad', $2, '2027-06-12', '08:00', $3, $4) RETURNING id`,
    [invitation.id, `${name} Akad`, venue, `Jalan ${name} 1`],
  );

  const accountNumber = `9${Math.floor(Math.random() * 1_000_000_000)}`;
  const { rows: accounts } = await pool.query<{ id: string }>(
    `INSERT INTO invitation_bank_accounts
       (invitation_id, type, provider_name, account_number, account_holder)
     VALUES ($1, 'bank', 'BCA', $2, $3) RETURNING id`,
    [invitation.id, accountNumber, `${name} Account Holder`],
  );

  const media = async (suffix: string): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO media (invitation_id, uploaded_by, purpose, status, storage_path)
       VALUES ($1, $2, 'gallery', 'ready', $3) RETURNING id`,
      [invitation.id, user.id, `uploads/${suffix}-${unique()}.jpg`],
    );
    return rows[0]!.id;
  };

  const mediaId = await media("attached");
  const spareMediaId = await media("spare");

  const caption = `${name} caption`;
  const { rows: photos } = await pool.query<{ id: string }>(
    `INSERT INTO invitation_gallery (invitation_id, media_id, caption, display_order)
     VALUES ($1, $2, $3, 0) RETURNING id`,
    [invitation.id, mediaId, caption],
  );

  // `P1-09`'s create service writes both people rows with the invitation, and
  // `CoupleService` is an UPDATE rather than an upsert for a documented reason. A fixture
  // that inserts the invitation straight into the table has to do the same, or the couple
  // endpoint refuses its own owner and the sweep reads it as a finding.
  await pool.query(
    `INSERT INTO invitation_people (invitation_id, role, full_name, nickname)
     VALUES ($1, 'groom', $2, $3), ($1, 'bride', $4, $5)`,
    [invitation.id, `${name} Groom`, name, `${name} Bride`, name],
  );

  await pool.query(
    `INSERT INTO invitation_quote (invitation_id, text, source) VALUES ($1, $2, $3)
     ON CONFLICT (invitation_id) DO UPDATE SET text = EXCLUDED.text`,
    [invitation.id, `${name} quote text`, `${name} source`],
  );

  return {
    invitation,
    eventId: events[0]!.id,
    bankAccountId: accounts[0]!.id,
    mediaId,
    spareMediaId,
    photoId: photos[0]!.id,
    markers: [
      `${name}'s wedding`,
      venue,
      accountNumber,
      caption,
      `${name} quote text`,
    ],
  };
}
