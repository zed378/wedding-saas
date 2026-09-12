import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { Pool } from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { connect, resetTenantData } from "./helpers.ts";
import { expectHttpIdorSafe } from "../support/idor";
import {
  createPhaseOneTenant,
  type PhaseOneTenant,
} from "../support/phase-one-tenant";

/**
 * P1-25 step 1 — the IDOR sweep, over HTTP, against the real application.
 *
 * ## Why this exists when every endpoint already has an IDOR test
 *
 * It does, and those tests are at the layer that matters most: `docs/SECURITY/04`
 * Implementation Principle 2 puts ownership in the service, so that is where each task
 * proved it. What no per-task test can prove is the property `docs/TESTING/04` § IDOR
 * Sweep actually asks for — that **every** endpoint in the phase, as routed, guarded,
 * parsed and serialised by the whole stack, answers a stranger with 404 and nothing.
 *
 * Three failures live in that gap and in no single service test:
 *
 *   - a route that reaches a service method nobody scoped — the route table is the
 *     inventory here, not the service;
 *   - a handler that catches the service's `NotFoundError` and answers 200 with a
 *     default;
 *   - an error body that names the resource it refused to return.
 *
 * ## It boots the real AppModule
 *
 * Real guards, real repositories, real Postgres, real Redis. The HTTP specs under
 * `test/*.spec.ts` stub their services, which is right for asserting a body schema and
 * useless for asserting authorization: a stub that throws `NotFoundError` proves the
 * controller forwards an error, not that the query was scoped.
 *
 * ## The matrix is generated, not written
 *
 * The card's DoD asks for a committed matrix of endpoint × outcome. It is emitted by this
 * run into `MEMORY/records/`, so it cannot claim a result the suite did not produce.
 */

const MATRIX_PATH = path.resolve(
  __dirname,
  "../../../../MEMORY/records/2026-09-12-P1-25-idor-matrix.md",
);

/** A JPEG header and an EOI. Enough for `detectFormat`, which is all this stage reads. */
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 0x20),
  Buffer.from([0xff, 0xd9]),
]);

interface Ctx {
  readonly server: unknown;
  readonly alice: PhaseOneTenant;
  readonly mallory: PhaseOneTenant;
}

type Attempt = (ctx: Ctx, token: string, t: PhaseOneTenant) => request.Test;

interface SweepCase {
  readonly label: string;
  /**
   * The request, parameterised by whose ids it addresses and whose token it carries.
   *
   * One function for both the attack and the positive control on purpose: two functions
   * drift, and a sweep whose "the owner can still do it" case exercises a different
   * request than its attack case proves nothing about the attack.
   */
  readonly send: Attempt;
  /**
   * The cross-parent case: the caller's OWN invitation in the path, another tenant's
   * child id in it. `docs/SECURITY/05` § 7's two-step rule is what this tests, and it is
   * a different bug from the parent case — a child looked up by its own id alone passes
   * every assertion above and leaks here.
   */
  readonly crossChild?: (ctx: Ctx) => request.Test;
  /**
   * The same cross-parent request with a **random** id in place of the foreign one.
   *
   * Present only where the correct answer is not a 404. `/gallery/reorder` takes the
   * whole arrangement and refuses any list that is not exactly this invitation's photos,
   * so a foreign photo id is a 422 rather than a 404 — and that is right, because the
   * complaint is about the list rather than about a resource the caller asked for. What
   * has to hold is that the answer is **indistinguishable** from one naming an id that
   * never existed: a different status or message would confirm Alice's photo is real.
   */
  readonly crossChildControl?: (ctx: Ctx) => request.Test;
  /**
   * The same-owner case: Alice's token, Alice's FIRST invitation in the path, Alice's
   * SECOND invitation's child id in it.
   *
   * Not a confidentiality problem — both weddings are hers — and a correctness one, which
   * is why it needs its own case. A repository that constrains only the OWNER accepts
   * this and edits the wrong wedding; a mutation removing the parent constraint from
   * `updateEvent` survived the cross-tenant sweep entirely and is caught here.
   */
  readonly crossOwnParent?: (ctx: Ctx) => request.Test;
  /** As `crossChildControl`, for the same-owner case. */
  readonly crossOwnParentControl?: (ctx: Ctx) => request.Test;
}

/** A uuid that names nothing, for the indistinguishability control. */
const ABSENT_ID = "00000000-0000-4000-8000-0000000000ff";

const api = (ctx: Ctx) => request(ctx.server as never);
const auth = (r: request.Test, token: string) =>
  r.set("Authorization", `Bearer ${token}`);

const CASES: readonly SweepCase[] = [
  {
    label: "GET /invitations/:id",
    send: (c, token, t) =>
      auth(api(c).get(`/api/v1/invitations/${t.invitation.id}`), token),
  },
  {
    label: "PATCH /invitations/:id",
    send: (c, token, t) =>
      auth(api(c).patch(`/api/v1/invitations/${t.invitation.id}`), token).send({
        internal_name: "renamed by the sweep",
      }),
  },
  {
    label: "DELETE /invitations/:id",
    send: (c, token, t) =>
      auth(api(c).delete(`/api/v1/invitations/${t.invitation.id}`), token),
  },
  {
    label: "PATCH /invitations/:id/couple/groom",
    send: (c, token, t) =>
      auth(
        api(c).patch(`/api/v1/invitations/${t.invitation.id}/couple/groom`),
        token,
      ).send({ nickname: "Sweep" }),
  },
  {
    label: "GET /invitations/:id/events",
    send: (c, token, t) =>
      auth(api(c).get(`/api/v1/invitations/${t.invitation.id}/events`), token),
  },
  {
    label: "POST /invitations/:id/events",
    send: (c, token, t) =>
      auth(
        api(c).post(`/api/v1/invitations/${t.invitation.id}/events`),
        token,
      ).send({
        type: "reception",
        title: "Resepsi",
        event_date: "2027-06-12",
        start_time: "11:00",
        venue_name: "Gedung Sweep",
        address: "Jalan Sweep 1",
      }),
  },
  {
    label: "PATCH /invitations/:id/events/:eventId",
    send: (c, token, t) =>
      auth(
        api(c).patch(
          `/api/v1/invitations/${t.invitation.id}/events/${t.eventId}`,
        ),
        token,
      ).send({ title: "retitled by the sweep" }),
    crossChild: (c) =>
      auth(
        api(c).patch(
          `/api/v1/invitations/${c.mallory.invitation.id}/events/${c.alice.eventId}`,
        ),
        c.mallory.token,
      ).send({ title: "retitled across tenants" }),
    crossOwnParent: (c) =>
      auth(
        api(c).patch(
          `/api/v1/invitations/${c.alice.invitation.id}/events/${c.alice.second.eventId}`,
        ),
        c.alice.token,
      ).send({ title: "retitled across the owner's own weddings" }),
  },
  {
    label: "DELETE /invitations/:id/events/:eventId",
    send: (c, token, t) =>
      auth(
        api(c).delete(
          `/api/v1/invitations/${t.invitation.id}/events/${t.eventId}`,
        ),
        token,
      ),
    crossChild: (c) =>
      auth(
        api(c).delete(
          `/api/v1/invitations/${c.mallory.invitation.id}/events/${c.alice.eventId}`,
        ),
        c.mallory.token,
      ),
    crossOwnParent: (c) =>
      auth(
        api(c).delete(
          `/api/v1/invitations/${c.alice.invitation.id}/events/${c.alice.second.eventId}`,
        ),
        c.alice.token,
      ),
  },
  {
    label: "GET /invitations/:id/bank-accounts",
    send: (c, token, t) =>
      auth(
        api(c).get(`/api/v1/invitations/${t.invitation.id}/bank-accounts`),
        token,
      ),
  },
  {
    label: "POST /invitations/:id/bank-accounts",
    send: (c, token, t) =>
      auth(
        api(c).post(`/api/v1/invitations/${t.invitation.id}/bank-accounts`),
        token,
      ).send({
        type: "bank",
        provider_name: "BNI",
        account_number: "1234567890",
        account_holder: "Sweep Holder",
      }),
  },
  {
    label: "PATCH /invitations/:id/bank-accounts/:bankAccountId",
    send: (c, token, t) =>
      auth(
        api(c).patch(
          `/api/v1/invitations/${t.invitation.id}/bank-accounts/${t.bankAccountId}`,
        ),
        token,
      ).send({ account_holder: "renamed by the sweep" }),
    crossChild: (c) =>
      auth(
        api(c).patch(
          `/api/v1/invitations/${c.mallory.invitation.id}/bank-accounts/${c.alice.bankAccountId}`,
        ),
        c.mallory.token,
      ).send({ account_number: "9999999999" }),
    crossOwnParent: (c) =>
      auth(
        api(c).patch(
          `/api/v1/invitations/${c.alice.invitation.id}/bank-accounts/${c.alice.second.bankAccountId}`,
        ),
        c.alice.token,
      ).send({ account_number: "8888888888" }),
  },
  {
    label: "DELETE /invitations/:id/bank-accounts/:bankAccountId",
    send: (c, token, t) =>
      auth(
        api(c).delete(
          `/api/v1/invitations/${t.invitation.id}/bank-accounts/${t.bankAccountId}`,
        ),
        token,
      ),
    crossChild: (c) =>
      auth(
        api(c).delete(
          `/api/v1/invitations/${c.mallory.invitation.id}/bank-accounts/${c.alice.bankAccountId}`,
        ),
        c.mallory.token,
      ),
    crossOwnParent: (c) =>
      auth(
        api(c).delete(
          `/api/v1/invitations/${c.alice.invitation.id}/bank-accounts/${c.alice.second.bankAccountId}`,
        ),
        c.alice.token,
      ),
  },
  {
    label: "GET /invitations/:id/quote",
    send: (c, token, t) =>
      auth(api(c).get(`/api/v1/invitations/${t.invitation.id}/quote`), token),
  },
  {
    label: "PATCH /invitations/:id/quote",
    send: (c, token, t) =>
      auth(
        api(c).patch(`/api/v1/invitations/${t.invitation.id}/quote`),
        token,
      ).send({ text: "written by the sweep" }),
  },
  {
    label: "GET /invitations/:id/settings",
    send: (c, token, t) =>
      auth(
        api(c).get(`/api/v1/invitations/${t.invitation.id}/settings`),
        token,
      ),
  },
  {
    label: "PATCH /invitations/:id/settings",
    send: (c, token, t) =>
      auth(
        api(c).patch(`/api/v1/invitations/${t.invitation.id}/settings`),
        token,
      ).send({ rsvp_enabled: false }),
  },
  {
    label: "POST /invitations/:id/change-template",
    send: (c, token, t) =>
      auth(
        api(c).post(`/api/v1/invitations/${t.invitation.id}/change-template`),
        token,
      ).send({ template_id: t.otherTemplate.templateId }),
  },
  {
    label: "GET /invitations/:id/gallery",
    send: (c, token, t) =>
      auth(api(c).get(`/api/v1/invitations/${t.invitation.id}/gallery`), token),
  },
  {
    label: "POST /invitations/:id/gallery",
    send: (c, token, t) =>
      auth(
        api(c).post(`/api/v1/invitations/${t.invitation.id}/gallery`),
        token,
      ).send({ media_id: t.spareMediaId }),
    // Mallory's own invitation, Alice's media. The check that matters is
    // `media.invitation_id = :this_invitation`, not "does the caller own some media".
    crossChild: (c) =>
      auth(
        api(c).post(`/api/v1/invitations/${c.mallory.invitation.id}/gallery`),
        c.mallory.token,
      ).send({ media_id: c.alice.spareMediaId }),
    crossOwnParent: (c) =>
      auth(
        api(c).post(`/api/v1/invitations/${c.alice.invitation.id}/gallery`),
        c.alice.token,
      ).send({ media_id: c.alice.second.spareMediaId }),
  },
  {
    label: "PATCH /invitations/:id/gallery/:photoId",
    send: (c, token, t) =>
      auth(
        api(c).patch(
          `/api/v1/invitations/${t.invitation.id}/gallery/${t.photoId}`,
        ),
        token,
      ).send({ caption: "recaptioned by the sweep" }),
    crossChild: (c) =>
      auth(
        api(c).patch(
          `/api/v1/invitations/${c.mallory.invitation.id}/gallery/${c.alice.photoId}`,
        ),
        c.mallory.token,
      ).send({ caption: "recaptioned across tenants" }),
    crossOwnParent: (c) =>
      auth(
        api(c).patch(
          `/api/v1/invitations/${c.alice.invitation.id}/gallery/${c.alice.second.photoId}`,
        ),
        c.alice.token,
      ).send({ caption: "recaptioned across the owner's own weddings" }),
  },
  {
    label: "DELETE /invitations/:id/gallery/:photoId",
    send: (c, token, t) =>
      auth(
        api(c).delete(
          `/api/v1/invitations/${t.invitation.id}/gallery/${t.photoId}`,
        ),
        token,
      ),
    crossChild: (c) =>
      auth(
        api(c).delete(
          `/api/v1/invitations/${c.mallory.invitation.id}/gallery/${c.alice.photoId}`,
        ),
        c.mallory.token,
      ),
    crossOwnParent: (c) =>
      auth(
        api(c).delete(
          `/api/v1/invitations/${c.alice.invitation.id}/gallery/${c.alice.second.photoId}`,
        ),
        c.alice.token,
      ),
  },
  {
    label: "POST /invitations/:id/gallery/reorder",
    send: (c, token, t) =>
      auth(
        api(c).post(`/api/v1/invitations/${t.invitation.id}/gallery/reorder`),
        token,
      ).send({ ordered_photo_ids: [t.photoId] }),
    crossChild: (c) =>
      auth(
        api(c).post(
          `/api/v1/invitations/${c.mallory.invitation.id}/gallery/reorder`,
        ),
        c.mallory.token,
      ).send({ ordered_photo_ids: [c.alice.photoId] }),
    crossChildControl: (c) =>
      auth(
        api(c).post(
          `/api/v1/invitations/${c.mallory.invitation.id}/gallery/reorder`,
        ),
        c.mallory.token,
      ).send({ ordered_photo_ids: [ABSENT_ID] }),
    crossOwnParent: (c) =>
      auth(
        api(c).post(
          `/api/v1/invitations/${c.alice.invitation.id}/gallery/reorder`,
        ),
        c.alice.token,
      ).send({ ordered_photo_ids: [c.alice.second.photoId] }),
    crossOwnParentControl: (c) =>
      auth(
        api(c).post(
          `/api/v1/invitations/${c.alice.invitation.id}/gallery/reorder`,
        ),
        c.alice.token,
      ).send({ ordered_photo_ids: [ABSENT_ID] }),
  },
  {
    label: "POST /invitations/:id/media",
    send: (c, token, t) =>
      auth(api(c).post(`/api/v1/invitations/${t.invitation.id}/media`), token)
        .field("purpose", "gallery")
        .attach("file", JPEG, {
          filename: "sweep.jpg",
          contentType: "image/jpeg",
        }),
  },
  {
    label: "GET /media/:mediaId",
    // There is no parent in this path at all, so the parent case IS the cross case:
    // ownership can only come from the join back to the invitation.
    send: (c, token, t) =>
      auth(api(c).get(`/api/v1/media/${t.mediaId}`), token),
  },
];

interface MatrixRow {
  readonly endpoint: string;
  readonly attack: number;
  readonly crossChild: number | undefined;
  /**
   * Set where the cross-parent answer is correct without being a 404, and was proved
   * identical to the answer an id that never existed gets.
   */
  readonly crossChildIndistinguishable: boolean;
  readonly crossOwnParent: number | undefined;
  readonly crossOwnParentIndistinguishable: boolean;
  readonly owner: number;
}

const matrix = new Map<string, Partial<MatrixRow> & { endpoint: string }>();
const record = (endpoint: string, patch: Partial<MatrixRow>): void => {
  matrix.set(endpoint, { ...(matrix.get(endpoint) ?? { endpoint }), ...patch });
};

describe("P1-25 — IDOR sweep over every Phase 1 :id endpoint", () => {
  let owner: Pool;
  let app: INestApplication;
  let ctx: Ctx;
  let signingKey: string;

  beforeAll(async () => {
    owner = await connect(["invitations", "media", "invitation_gallery"]);
    await resetTenantData(owner);

    signingKey = "phase-1-sweep-signing-key-0000000000000000";

    // The application role, not the owner: the app must reach these rows through the
    // same grants production gives it, or the sweep would prove nothing about the
    // permissions that actually apply.
    process.env["DATABASE_URL"] = (
      process.env["MIGRATION_DATABASE_URL"] ??
      "postgres://wedding_owner:wedding_owner_dev@localhost:55432/wedding"
    ).replace(/\/\/[^@]+@/, "//wedding_app:wedding_app_dev@");
    process.env["REDIS_URL"] =
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56379";
    process.env["JWT_SIGNING_KEY"] = signingKey;
    // The sweep sends around seventy authenticated requests as a handful of users,
    // several of them to `settings`, whose real policy is three a day (BR-6.2). Raised
    // here rather than worked around: the limiter has its own suite
    // (`rate-limit.itest.ts`), and a sweep that started answering 429 would be reporting
    // "not 200" as though it were "not authorised".
    process.env["RATE_LIMIT_OVERRIDES"] = JSON.stringify({
      "slug-change": { limit: 5_000, windowSeconds: 60 },
      "general-authenticated": { limit: 5_000, windowSeconds: 60 },
      "media-upload": { limit: 5_000, windowSeconds: 60 },
      "invitation-create": { limit: 5_000, windowSeconds: 60 },
    });

    const { AppModule } = await import("../../src/app.module.ts");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    ctx = {
      server: app.getHttpServer(),
      alice: await createPhaseOneTenant(owner, signingKey, "Alice"),
      mallory: await createPhaseOneTenant(owner, signingKey, "Mallory"),
    };
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    writeMatrix();
  });

  /**
   * The attack. Mallory's token, Alice's ids, every endpoint.
   *
   * Deliberately first: none of these requests may change anything, so the fixtures they
   * run against are the same ones the later cases read. If an attack DID mutate, the
   * cross-parent case that follows would be operating on changed data — and would say
   * so, which is a property worth having.
   */
  it.each(CASES.map((c) => [c.label, c] as const))(
    "%s answers a non-owner with 404 and no data",
    async (label, sweepCase) => {
      let status = 0;
      await expectHttpIdorSafe(
        async () => {
          const res = await sweepCase.send(ctx, ctx.mallory.token, ctx.alice);
          status = res.status;
          return res;
        },
        { mustNotContain: ctx.alice.markers },
      );
      record(label, { attack: status });
    },
  );

  /**
   * The cross-parent case. `docs/SECURITY/05` § 7.
   *
   * Mallory owns the invitation in the path and does not own the child id in it. A
   * repository that resolves the child by its own id and then checks the parent it
   * returns — rather than constraining both in one query — passes every assertion above
   * and fails here.
   */
  const childCases = CASES.filter((c) => c.crossChild !== undefined);
  it.each(childCases.map((c) => [c.label, c] as const))(
    "%s refuses another tenant's child id under the caller's own invitation",
    async (label, sweepCase) => {
      const control = sweepCase.crossChildControl;

      if (control === undefined) {
        let status = 0;
        await expectHttpIdorSafe(
          async () => {
            const res = await sweepCase.crossChild!(ctx);
            status = res.status;
            return res;
          },
          { mustNotContain: ctx.alice.markers },
        );
        record(label, { crossChild: status });
        return;
      }

      const attacked = await sweepCase.crossChild!(ctx);
      const absent = await control(ctx);

      expect(
        attacked.status,
        "the request must be refused",
      ).toBeGreaterThanOrEqual(400);
      // The whole point: an attacker holding a real photo id must not be able to tell it
      // apart from one they invented.
      expect(
        { status: attacked.status, body: attacked.body },
        "a foreign id must answer exactly as an absent one does, or the difference " +
          "confirms the resource exists",
      ).toEqual({ status: absent.status, body: absent.body });

      for (const marker of ctx.alice.markers) {
        expect(JSON.stringify(attacked.body)).not.toContain(marker);
      }
      record(label, {
        crossChild: attacked.status,
        crossChildIndistinguishable: true,
      });
    },
  );

  /**
   * The same-owner case. One user, two weddings, and the child id from the wrong one.
   *
   * This is not about confidentiality — both rows are Alice's — and it is still a bug
   * worth a test: the endpoint would be editing a wedding the user did not name. It also
   * catches a class the cross-tenant case cannot. A repository whose only condition is
   * `EXISTS (… i.owner_id = :scope)` answers this one 200, and every assertion above
   * stays green, because Mallory is still refused.
   */
  const ownParentCases = CASES.filter((c) => c.crossOwnParent !== undefined);
  it.each(ownParentCases.map((c) => [c.label, c] as const))(
    "%s refuses the caller's OTHER invitation's child id",
    async (label, sweepCase) => {
      const attacked = await sweepCase.crossOwnParent!(ctx);
      const control = sweepCase.crossOwnParentControl;

      if (control === undefined) {
        expect(
          attacked.status,
          `${label} accepted a child id belonging to the caller's other invitation — ` +
            "the request would edit a wedding the user did not name",
        ).toBe(404);
        record(label, { crossOwnParent: attacked.status });
        return;
      }

      const absent = await control(ctx);
      expect(attacked.status).toBeGreaterThanOrEqual(400);
      expect({
        status: attacked.status,
        body: attacked.body,
      }).toEqual({ status: absent.status, body: absent.body });
      record(label, {
        crossOwnParent: attacked.status,
        crossOwnParentIndistinguishable: true,
      });
    },
  );

  /**
   * The positive control, and it is not a formality.
   *
   * A repository that returned nothing to everybody would pass every assertion above.
   * Each of these runs against a **fresh** tenant, because several of them delete the
   * thing they address.
   */
  it.each(CASES.map((c) => [c.label, c] as const))(
    "%s still answers the owner",
    async (label, sweepCase) => {
      const tenant = await createPhaseOneTenant(owner, signingKey, "Owner");
      const res = await sweepCase.send(ctx, tenant.token, tenant);

      expect(
        res.status,
        `${label} refused its own owner with ${String(res.status)} — a check that ` +
          "refuses everybody passes every IDOR test and ships a broken product",
      ).toBeLessThan(400);
      record(label, { owner: res.status });
    },
    30_000,
  );

  it("refuses every one of them without a token", async () => {
    const statuses = await Promise.all(
      CASES.map(async (sweepCase) => {
        const res = await sweepCase.send(ctx, "", ctx.alice);
        return { label: sweepCase.label, status: res.status };
      }),
    );

    // 401, not 404: authentication is about the caller, and `docs/API/00` reserves 404
    // for "this resource is not yours to see", which cannot be decided before we know
    // who is asking.
    const wrong = statuses.filter((s) => s.status !== 401);
    expect(
      wrong,
      "every :id endpoint must answer 401 without a bearer token",
    ).toEqual([]);
  });
});

function writeMatrix(): void {
  const rows = [...matrix.values()].sort((a, b) =>
    a.endpoint.localeCompare(b.endpoint),
  );
  if (rows.length === 0) return;

  const cell = (n: number | undefined): string =>
    n === undefined ? "—" : String(n);
  const childCell = (r: (typeof rows)[number]): string =>
    r.crossChildIndistinguishable === true
      ? `${cell(r.crossChild)} — same as an absent id`
      : cell(r.crossChild);
  const ownCell = (r: (typeof rows)[number]): string =>
    r.crossOwnParentIndistinguishable === true
      ? `${cell(r.crossOwnParent)} — same as an absent id`
      : cell(r.crossOwnParent);
  const verdict = (r: (typeof rows)[number]): string => {
    const attackOk = r.attack === 404;
    const childOk =
      r.crossChild === undefined ||
      r.crossChild === 404 ||
      r.crossChildIndistinguishable === true;
    const ownOk =
      r.crossOwnParent === undefined ||
      r.crossOwnParent === 404 ||
      r.crossOwnParentIndistinguishable === true;
    const ownerOk = r.owner !== undefined && r.owner < 400;
    return attackOk && childOk && ownOk && ownerOk ? "**pass**" : "**FAIL**";
  };

  const body = [
    "# P1-25 — IDOR sweep result",
    "",
    "**Generated by `backend/api/test/integration/idor-sweep.itest.ts`. Do not edit by hand.**",
    "",
    "`docs/TESTING/04` § IDOR Sweep asks for a matrix of endpoint × outcome. This is that",
    "matrix, emitted by the run rather than transcribed from it — a hand-written matrix can",
    "claim a pass the suite never produced, which is the failure mode `MEMORY/README.md`'s",
    "honesty rule exists to stop.",
    "",
    "Columns:",
    "",
    "- **non-owner** — Mallory's token, Alice's ids. Must be 404.",
    "- **cross-parent** — Mallory's own invitation in the path, Alice's child id in it.",
    "  Must be 404, or — where the endpoint's correct answer is a validation error about",
    "  the request rather than a resource — must be byte-identical to the answer an id",
    "  that never existed gets. An em dash means the endpoint addresses no child.",
    "- **own other wedding** — Alice's token, her first invitation in the path, her",
    "  SECOND invitation's child id in it. Must be refused: it is not a leak, it is the",
    "  endpoint editing a wedding the user did not name.",
    "- **owner** — the owner's own request. Must be under 400, or the check refuses",
    "  everybody and the product is broken rather than secure.",
    "",
    `Run: ${new Date().toISOString()}`,
    "",
    "| Endpoint | non-owner | cross-parent | own other wedding | owner | Verdict |",
    "|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| \`${r.endpoint}\` | ${cell(r.attack)} | ${childCell(r)} | ${ownCell(r)} | ${cell(r.owner)} | ${verdict(r)} |`,
    ),
    "",
    `${String(rows.length)} endpoints swept. Every response body was also searched for the`,
    "other tenant's venue name, account number, caption, quote and internal name — a 404",
    "that still carries the resource is a leak with a misleading status code.",
    "",
  ].join("\n");

  mkdirSync(path.dirname(MATRIX_PATH), { recursive: true });
  writeFileSync(MATRIX_PATH, body, "utf8");
}
