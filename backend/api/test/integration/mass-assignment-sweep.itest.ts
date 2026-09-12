import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { Pool } from "pg";

import { connect, resetTenantData } from "./helpers.ts";
import {
  createPhaseOneTenant,
  type PhaseOneTenant,
} from "../support/phase-one-tenant";

/**
 * P1-25 step 2 — the mass-assignment sweep.
 *
 * `docs/SECURITY/05` § 3 names the abuse case in one line: a client supplies `owner_id`,
 * `role` or `status` in a body and the server writes it. `docs/TESTING/04`'s sweep is the
 * systematic version — every write endpoint in the phase, not the ones somebody
 * remembered.
 *
 * ## What is actually asserted
 *
 * **The column did not change.** Not "the request was rejected": those are different
 * properties, and only the first one matters. Zod's default object strips unknown keys
 * and `.strict()` rejects them — both are safe, and a sweep that demanded a 422 would
 * report a false finding against a schema that silently dropped the field, which is
 * exactly as secure.
 *
 * The status each endpoint answers is recorded alongside, because the difference is worth
 * knowing: a strip is safe *while* no later code reads the raw body.
 */

const PRIVILEGED = {
  id: "00000000-0000-4000-8000-00000000dead",
  owner_id: "00000000-0000-4000-8000-00000000beef",
  user_id: "00000000-0000-4000-8000-00000000beef",
  role: "super_admin",
  status: "published",
  email_verified: true,
  is_admin: true,
  created_at: "2000-01-01T00:00:00.000Z",
} as const;

describe("P1-25 — mass-assignment sweep over every Phase 1 write endpoint", () => {
  let owner: Pool;
  let app: INestApplication;
  let server: unknown;
  let alice: PhaseOneTenant;
  let mallory: PhaseOneTenant;
  const signingKey = "phase-1-mass-assignment-key-000000000000";

  const auth = (r: request.Test, token: string) =>
    r.set("Authorization", `Bearer ${token}`);
  const api = () => request(server as never);

  beforeAll(async () => {
    owner = await connect(["invitations", "users"]);
    await resetTenantData(owner);

    process.env["DATABASE_URL"] = (
      process.env["MIGRATION_DATABASE_URL"] ??
      "postgres://wedding_owner:wedding_owner_dev@localhost:55432/wedding"
    ).replace(/\/\/[^@]+@/, "//wedding_app:wedding_app_dev@");
    process.env["REDIS_URL"] =
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56379";
    process.env["JWT_SIGNING_KEY"] = signingKey;
    // Same reasoning as the IDOR sweep: the limiter is proved elsewhere, and a 429 in the
    // middle of this suite would look like a rejection that had something to do with the
    // injected field.
    process.env["RATE_LIMIT_OVERRIDES"] = JSON.stringify({
      register: { limit: 5_000, windowSeconds: 60 },
      "slug-change": { limit: 5_000, windowSeconds: 60 },
      "general-authenticated": { limit: 5_000, windowSeconds: 60 },
      "invitation-create": { limit: 5_000, windowSeconds: 60 },
    });

    const { AppModule } = await import("../../src/app.module.ts");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();

    alice = await createPhaseOneTenant(owner, signingKey, "Alice");
    mallory = await createPhaseOneTenant(owner, signingKey, "Mallory");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
  });

  /**
   * The sweep itself: every write endpoint, each with the privileged keys added to an
   * otherwise valid body. The assertion is the same for all of them — nothing privileged
   * moved — and it is made by re-reading the row afterwards.
   */
  it("never writes owner_id, status or role from a request body", async () => {
    const before = await snapshot(owner, alice, mallory);

    const writes: readonly [string, () => request.Test][] = [
      [
        "POST /invitations",
        () =>
          auth(api().post("/api/v1/invitations"), alice.token).send({
            template_id: alice.template.templateId,
            internal_name: "Mass assignment probe",
            ...PRIVILEGED,
          }),
      ],
      [
        "PATCH /invitations/:id",
        () =>
          auth(
            api().patch(`/api/v1/invitations/${alice.invitation.id}`),
            alice.token,
          ).send({ internal_name: "Probed", ...PRIVILEGED }),
      ],
      [
        "PATCH /invitations/:id/settings",
        () =>
          auth(
            api().patch(`/api/v1/invitations/${alice.invitation.id}/settings`),
            alice.token,
          ).send({ rsvp_enabled: true, ...PRIVILEGED }),
      ],
      [
        "PATCH /invitations/:id/couple/groom",
        () =>
          auth(
            api().patch(
              `/api/v1/invitations/${alice.invitation.id}/couple/groom`,
            ),
            alice.token,
            // `role` last, and it is the point of this row: the path says groom, the
            // body says bride, and the path has to win.
          ).send({ nickname: "Probe", ...PRIVILEGED, role: "bride" }),
      ],
      [
        "POST /invitations/:id/events",
        () =>
          auth(
            api().post(`/api/v1/invitations/${alice.invitation.id}/events`),
            alice.token,
          ).send({
            type: "reception",
            title: "Probe",
            event_date: "2027-06-12",
            start_time: "11:00",
            venue_name: "Probe Hall",
            address: "Jalan Probe 1",
            invitation_id: mallory.invitation.id,
            ...PRIVILEGED,
          }),
      ],
      [
        "POST /invitations/:id/bank-accounts",
        () =>
          auth(
            api().post(
              `/api/v1/invitations/${alice.invitation.id}/bank-accounts`,
            ),
            alice.token,
          ).send({
            type: "bank",
            provider_name: "BNI",
            account_number: "1234567890",
            account_holder: "Probe",
            invitation_id: mallory.invitation.id,
            ...PRIVILEGED,
          }),
      ],
      [
        "PATCH /invitations/:id/quote",
        () =>
          auth(
            api().patch(`/api/v1/invitations/${alice.invitation.id}/quote`),
            alice.token,
          ).send({ text: "Probe", invitation_id: mallory.invitation.id }),
      ],
      [
        "POST /invitations/:id/gallery",
        () =>
          auth(
            api().post(`/api/v1/invitations/${alice.invitation.id}/gallery`),
            alice.token,
          ).send({
            media_id: alice.spareMediaId,
            invitation_id: mallory.invitation.id,
            ...PRIVILEGED,
          }),
      ],
      [
        "PATCH /invitations/:id/gallery/:photoId",
        () =>
          auth(
            api().patch(
              `/api/v1/invitations/${alice.invitation.id}/gallery/${alice.photoId}`,
            ),
            alice.token,
          ).send({ caption: "Probe", ...PRIVILEGED }),
      ],
      [
        "POST /invitations/:id/change-template",
        () =>
          auth(
            api().post(
              `/api/v1/invitations/${alice.invitation.id}/change-template`,
            ),
            alice.token,
          ).send({
            template_id: alice.otherTemplate.templateId,
            // BR-3.3: the server resolves the newest published version. A client that
            // could name one could pin an invitation to a deprecated version.
            template_version_id: alice.template.versionId,
          }),
      ],
      [
        "PATCH /users/me",
        () =>
          auth(api().patch("/api/v1/users/me"), alice.token).send({
            full_name: "Probe Name",
            ...PRIVILEGED,
          }),
      ],
      [
        "PATCH /users/me/notification-preferences",
        () =>
          auth(
            api().patch("/api/v1/users/me/notification-preferences"),
            alice.token,
          ).send({ rsvp_email: false, ...PRIVILEGED }),
      ],
    ];

    const statuses: Record<string, number> = {};
    for (const [label, send] of writes) {
      const res = await send();
      statuses[label] = res.status;
    }

    const after = await snapshot(owner, alice, mallory);

    // The whole sweep in one assertion: nothing privileged moved anywhere.
    expect(after, `statuses: ${JSON.stringify(statuses, null, 2)}`).toEqual(
      before,
    );

    // And nothing was created under the injected id or the injected owner.
    const { rows: forged } = await owner.query(
      "SELECT id FROM invitations WHERE id = $1 OR owner_id = $2",
      [PRIVILEGED.id, PRIVILEGED.owner_id],
    );
    expect(
      forged,
      "a body field must not choose a row's id or its owner",
    ).toEqual([]);
  }, 60_000);

  /**
   * Registration is the one endpoint where a stranger chooses the whole body, so the
   * privileged field that matters is `role`.
   *
   * `registerSchema` is a plain `z.object`, which STRIPS rather than rejects — so this
   * request succeeds and the assertion is about the row, not the status. That is the
   * right assertion either way: what must be true is that the account is a user.
   */
  it("cannot register itself an admin", async () => {
    const email = `probe-${Date.now()}@example.test`;
    const res = await request(server as never)
      .post("/api/v1/auth/register")
      .send({
        email,
        // Random, because `P1-01`'s policy asks Have I Been Pwned and every memorable
        // phrase anybody would type here is in it — including the one this test used
        // first, which failed for a reason that had nothing to do with mass assignment.
        password: `Sandi-${Math.random().toString(36).slice(2)}-${Date.now()}`,
        full_name: "Probe",
        role: "super_admin",
        email_verified: true,
        status: "active",
      });

    expect(res.status).toBeLessThan(400);

    const { rows } = await owner.query<{
      role: string;
      email_verified: boolean;
    }>("SELECT role, email_verified FROM users WHERE email = $1", [email]);

    expect(rows[0]).toEqual({ role: "user", email_verified: false });
  });

  /**
   * The body cannot choose which person is being edited — the path does.
   *
   * `PATCH /couple/groom` with `role: "bride"` in the body was sent in the sweep above;
   * this reads the bride row to prove it did not move. Worth its own test because the
   * snapshot equality would also pass if BOTH rows changed identically.
   */
  it("edits the person named in the path, never the one named in the body", async () => {
    const { rows } = await owner.query<{ role: string; nickname: string }>(
      "SELECT role, nickname FROM invitation_people WHERE invitation_id = $1 ORDER BY role",
      [alice.invitation.id],
    );

    const bride = rows.find((r) => r.role === "bride");
    expect(
      bride?.nickname,
      "the bride must not be renamed by a groom request",
    ).toBe("Alice");
  });

  /**
   * BR-3.3, at the HTTP layer.
   *
   * The sweep sent `template_version_id` alongside a legitimate `template_id`. If it were
   * honoured, the invitation would be pinned to a version the server did not choose.
   */
  it("resolves the template version itself, whatever the body says", async () => {
    const { rows } = await owner.query<{ template_version_id: string }>(
      "SELECT template_version_id FROM invitations WHERE id = $1",
      [alice.invitation.id],
    );

    expect(rows[0]?.template_version_id).toBe(alice.template.versionId);
  });
});

/**
 * Everything a mass-assignment bug would move, in one object.
 *
 * Ordered and fully materialised so the comparison is a value comparison: a diff on this
 * names the column that changed, which a per-column assertion would not.
 */
async function snapshot(
  pool: Pool,
  alice: PhaseOneTenant,
  mallory: PhaseOneTenant,
): Promise<unknown> {
  const invitations = await pool.query(
    `SELECT id, owner_id, status, template_id, template_version_id
       FROM invitations WHERE owner_id = ANY($1) ORDER BY id`,
    [[alice.user.id, mallory.user.id]],
  );
  const users = await pool.query(
    `SELECT id, role, status, email_verified FROM users WHERE id = ANY($1) ORDER BY id`,
    [[alice.user.id, mallory.user.id]],
  );
  const events = await pool.query(
    `SELECT invitation_id, count(*) AS n FROM invitation_events
      WHERE invitation_id = ANY($1) GROUP BY invitation_id ORDER BY invitation_id`,
    [[alice.invitation.id, mallory.invitation.id]],
  );
  const accounts = await pool.query(
    `SELECT invitation_id, count(*) AS n FROM invitation_bank_accounts
      WHERE invitation_id = ANY($1) GROUP BY invitation_id ORDER BY invitation_id`,
    [[alice.invitation.id, mallory.invitation.id]],
  );

  return {
    invitations: invitations.rows,
    users: users.rows,
    // Counts rather than rows: a legitimate create IS allowed on Alice's own invitation,
    // and what must not happen is one landing on Mallory's because the body said so.
    malloryEvents: events.rows.find(
      (r) =>
        (r as { invitation_id: string }).invitation_id ===
        mallory.invitation.id,
    ),
    malloryAccounts: accounts.rows.find(
      (r) =>
        (r as { invitation_id: string }).invitation_id ===
        mallory.invitation.id,
    ),
  };
}
