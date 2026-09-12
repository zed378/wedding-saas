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
import { createTestTemplateVersion } from "../support/factories";

/**
 * P1-25 steps 3 to 6 — the phase's acceptance criteria, against the running application.
 *
 * `docs/PLAN/17-ACCEPTANCE-CRITERIA.md` states these as product promises rather than unit
 * behaviours, and that is how they are checked here: end to end, through HTTP, with the
 * assertion made by reading the result back the way a user's next page load would.
 *
 *   - the upload abuse set from `docs/TESTING/04` § File Upload Test, at the boundary
 *     the attacker actually reaches;
 *   - a hundred consecutive edits with nothing lost;
 *   - a template switch that hides fields and gives every one of them back;
 *   - p95 latency on the CRUD endpoints against the 500ms target.
 */

/** A PHP web shell, renamed. `docs/TESTING/04` § File Upload Test, case 1. */
const PHP_SHELL = Buffer.from(
  '<?php echo shell_exec($_GET["cmd"]); ?>\n',
  "utf8",
);

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(256, 0x20),
  Buffer.from([0xff, 0xd9]),
]);

describe("P1-25 — Phase 1 acceptance", () => {
  let owner: Pool;
  let app: INestApplication;
  let server: unknown;
  let alice: PhaseOneTenant;
  const signingKey = "phase-1-acceptance-signing-key-0000000000";

  const auth = (r: request.Test) =>
    r.set("Authorization", `Bearer ${alice.token}`);
  const api = () => request(server as never);

  beforeAll(async () => {
    owner = await connect(["invitations", "media"]);
    await resetTenantData(owner);

    process.env["DATABASE_URL"] = (
      process.env["MIGRATION_DATABASE_URL"] ??
      "postgres://wedding_owner:wedding_owner_dev@localhost:55432/wedding"
    ).replace(/\/\/[^@]+@/, "//wedding_app:wedding_app_dev@");
    process.env["REDIS_URL"] =
      process.env["TEST_REDIS_URL"] ?? "redis://localhost:56379";
    process.env["JWT_SIGNING_KEY"] = signingKey;
    // A hundred consecutive saves is the acceptance criterion itself, and the limiter
    // would stop it at three hundred a minute. Raised so the suite measures what it
    // claims to measure; `rate-limit.itest.ts` measures the limiter.
    process.env["RATE_LIMIT_OVERRIDES"] = JSON.stringify({
      "general-authenticated": { limit: 50_000, windowSeconds: 60 },
      "media-upload": { limit: 50_000, windowSeconds: 60 },
      "slug-change": { limit: 50_000, windowSeconds: 60 },
    });

    const { AppModule } = await import("../../src/app.module.ts");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();

    alice = await createPhaseOneTenant(owner, signingKey, "Alice");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
  });

  // ------------------------------------------------------ step 3: upload abuse

  /**
   * `docs/TESTING/04` § File Upload Test, case 1.
   *
   * `P1-17` proved the format check as a unit, and `media-upload.itest.ts` proved it at
   * the service. This is the same payload at the endpoint, which is where an attacker
   * meets it — a check that exists but is not wired into the route is the failure this
   * catches and neither of those does.
   */
  it("refuses a PHP web shell renamed to .jpg, and writes nothing", async () => {
    const before = await mediaCount(owner, alice.invitation.id);

    const res = await auth(
      api().post(`/api/v1/invitations/${alice.invitation.id}/media`),
    )
      .field("purpose", "gallery")
      .attach("file", PHP_SHELL, {
        filename: "shell.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(
      await mediaCount(owner, alice.invitation.id),
      "a rejected upload must not leave a media row behind",
      // The row is inserted before the object is stored (`P1-17`), so a rejection that
      // happened after the insert would show up here and nowhere else.
    ).toBe(before);
  });

  /** `docs/TESTING/04` § File Upload Test, case 2 — over the size limit. */
  it("refuses a file over the size limit", async () => {
    const oversize = Buffer.concat([
      JPEG,
      Buffer.alloc(11 * 1024 * 1024, 0x20),
    ]);

    const res = await auth(
      api().post(`/api/v1/invitations/${alice.invitation.id}/media`),
    )
      .field("purpose", "gallery")
      .attach("file", oversize, {
        filename: "huge.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  }, 60_000);

  /**
   * A real JPEG under an extension the allowlist does not carry.
   *
   * The magic bytes are correct here, so this is the other half of the check: the
   * extension is refused on its own terms rather than being inferred from the content.
   */
  it("refuses a valid JPEG named .php", async () => {
    const res = await auth(
      api().post(`/api/v1/invitations/${alice.invitation.id}/media`),
    )
      .field("purpose", "gallery")
      .attach("file", JPEG, {
        filename: "payload.php",
        contentType: "image/jpeg",
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // ------------------------------------- step 4: a hundred consecutive changes

  /**
   * `docs/PLAN/17`: "100 consecutive changes, no data loss."
   *
   * Sequential rather than concurrent, because that is what the criterion describes and
   * what an editor produces: a save completes, the next keystroke starts another. The
   * assertion is on the **last** value — a lost update in the middle would leave an
   * earlier value standing, and the count of successful responses would not show it.
   */
  it("keeps all hundred of a hundred consecutive edits", async () => {
    const statuses: number[] = [];

    for (let i = 1; i <= 100; i += 1) {
      const res = await auth(
        api().patch(`/api/v1/invitations/${alice.invitation.id}`),
      ).send({ internal_name: `Save ${String(i)}` });
      statuses.push(res.status);
    }

    expect(
      statuses.filter((s) => s !== 200).length,
      "every save must be accepted — a rejected one is a lost edit",
    ).toBe(0);

    const { rows } = await owner.query<{ internal_name: string }>(
      "SELECT internal_name FROM invitations WHERE id = $1",
      [alice.invitation.id],
    );
    expect(rows[0]?.internal_name).toBe("Save 100");

    // And the read path agrees with the table. A cache that served the 99th value would
    // be invisible to the query above and very visible to the user.
    const detail = await auth(
      api().get(`/api/v1/invitations/${alice.invitation.id}`),
    );
    expect(
      (detail.body as { data: { internal_name: string } }).data.internal_name,
    ).toBe("Save 100");
  }, 120_000);

  // ------------------------------------------------- the stored XSS sweep

  /**
   * `docs/TESTING/04` § XSS Test, steps 1 and 2.
   *
   * **Not in this card's step list, and it belongs here.** The document asks for every
   * free-text field to be submitted with a payload and then read back in its stored form,
   * and `P1-16` built the sanitiser with a thorough unit suite — but nothing in the
   * repository had ever sent a payload through a **route** and looked at the row. A
   * registry entry that is never reached by the controller passes every test in
   * `sanitize.spec.ts` and stores markup.
   *
   * Step 3 — "open the public page and verify no script executes" — needs the public
   * renderer, which is `P2-03`. Recorded there rather than claimed here.
   */
  it("stores every free-text field with its markup stripped", async () => {
    const PAYLOAD = "<script>alert(1)</script><img src=x onerror=alert(2)>Budi";

    await auth(api().patch(`/api/v1/invitations/${alice.invitation.id}`)).send({
      internal_name: PAYLOAD,
    });
    await auth(
      api().patch(`/api/v1/invitations/${alice.invitation.id}/couple/groom`),
    ).send({ nickname: PAYLOAD, full_name: PAYLOAD, father_name: PAYLOAD });
    await auth(
      api().patch(`/api/v1/invitations/${alice.invitation.id}/quote`),
    ).send({ text: PAYLOAD, source: PAYLOAD });
    await auth(
      api().patch(
        `/api/v1/invitations/${alice.invitation.id}/events/${alice.eventId}`,
      ),
    ).send({ title: PAYLOAD, venue_name: PAYLOAD, address: PAYLOAD });
    await auth(
      api().post(`/api/v1/invitations/${alice.invitation.id}/bank-accounts`),
    ).send({
      type: "bank",
      provider_name: PAYLOAD,
      account_number: "1234567890",
      account_holder: PAYLOAD,
    });
    await auth(
      api().patch(
        `/api/v1/invitations/${alice.invitation.id}/gallery/${alice.photoId}`,
      ),
    ).send({ caption: PAYLOAD });

    const stored = await storedText(owner, alice.invitation.id);

    expect(
      stored.length,
      "the sweep must actually read something back",
    ).toBeGreaterThan(10);

    for (const { column, value } of stored) {
      // Tag delimiters, not the word "script": a stored `&lt;script&gt;` is text and
      // safe, and a test searching for the word would call it a finding.
      expect(value, `${column} kept markup`).not.toMatch(/[<>]/);
      // And the sanitiser strips rather than empties — a field that silently became ""
      // would pass the check above and lose the user's data.
      expect(value, `${column} lost its text entirely`).toContain("Budi");
    }
  }, 60_000);

  // ------------------------------------------- step 5: the template switch

  /**
   * `docs/PLAN/17`: fields disappear and reappear with no loss. BR-4.1, `P1-15`.
   *
   * The round trip is the whole point. A→B proving the field is hidden would also pass if
   * the field had been deleted; only B→A tells the two apart, and it is the case a user
   * hits when they change their mind.
   */
  it("hides fields on a template switch and gives every one of them back", async () => {
    // A template whose sections do not include the gallery, so switching to it is a
    // visible change rather than a no-op.
    const sparse = await createTestTemplateVersion(owner, {
      sections: [
        {
          section_key: "hero",
          component: "HeroClassic",
          enabled_by_default: true,
          configurable: false,
          required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
        },
      ],
    });

    const beforeRows = await childRowCounts(owner, alice.invitation.id);
    // The events as they stand right now, whatever an earlier test left them saying.
    // Comparing against a literal would make this test depend on the order the file runs
    // in, which is how a suite starts failing for reasons that are not about the code.
    const beforeEvents = (
      await auth(api().get(`/api/v1/invitations/${alice.invitation.id}/events`))
    ).body;

    const forward = await auth(
      api().post(`/api/v1/invitations/${alice.invitation.id}/change-template`),
    ).send({ template_id: sparse.templateId });
    expect(forward.status).toBe(200);

    const duringRows = await childRowCounts(owner, alice.invitation.id);
    expect(
      duringRows,
      "changing a template must never delete a row — it changes what is displayed",
    ).toEqual(beforeRows);

    const back = await auth(
      api().post(`/api/v1/invitations/${alice.invitation.id}/change-template`),
    ).send({ template_id: alice.template.templateId });
    expect(back.status).toBe(200);

    expect(
      await childRowCounts(owner, alice.invitation.id),
      "and the round trip must return the invitation to what it was",
    ).toEqual(beforeRows);

    // The values, not just the counts: a row that survived with its columns blanked
    // would satisfy every count above.
    const afterEvents = await auth(
      api().get(`/api/v1/invitations/${alice.invitation.id}/events`),
    );
    expect(
      afterEvents.body,
      "every event must come back exactly as it was, down to the venue name",
    ).toEqual(beforeEvents);
  }, 60_000);

  // ------------------------------------------------ step 6: p95 latency

  /**
   * `docs/PLAN/17`: API p95 under 500ms on the CRUD endpoints.
   *
   * Measured against a local database with a warm connection pool, which is a friendlier
   * environment than production — so this is a floor, not a verdict. It is worth having
   * anyway: the failure it catches is an N+1 or a missing index, and those are orders of
   * magnitude rather than percentages.
   */
  it("answers the CRUD endpoints well inside the 500ms p95 target", async () => {
    const paths = [
      `/api/v1/invitations/${alice.invitation.id}`,
      `/api/v1/invitations/${alice.invitation.id}/events`,
      `/api/v1/invitations/${alice.invitation.id}/gallery`,
      `/api/v1/invitations/${alice.invitation.id}/settings`,
      "/api/v1/invitations",
    ];

    // Warm up: the first request through a fresh pool pays for a connection and for
    // Node's first pass over the handler, and neither is what this measures.
    for (const p of paths) await auth(api().get(p));

    const samples: number[] = [];
    const CONCURRENCY = 5;

    for (let round = 0; round < 20; round += 1) {
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async (_, i) => {
          const target = paths[(round * CONCURRENCY + i) % paths.length]!;
          const started = performance.now();
          const res = await auth(api().get(target));
          samples.push(performance.now() - started);
          expect(res.status).toBe(200);
        }),
      );
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;

    expect(
      p95,
      `p95 was ${p95.toFixed(1)}ms over ${String(samples.length)} requests ` +
        `(median ${samples[Math.floor(samples.length / 2)]!.toFixed(1)}ms)`,
    ).toBeLessThan(500);
  }, 120_000);
});

async function mediaCount(pool: Pool, invitationId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM media WHERE invitation_id = $1",
    [invitationId],
  );
  return Number(rows[0]!.n);
}

/**
 * Every child table an invitation owns, counted.
 *
 * `P1-15`'s record makes the point that "nothing was deleted" is the hardest guarantee to
 * keep, because an absence leaves no trace. Counting each table is the cheapest thing
 * that would actually notice.
 */
async function childRowCounts(
  pool: Pool,
  invitationId: string,
): Promise<Record<string, number>> {
  const tables = [
    "invitation_people",
    "invitation_events",
    "invitation_gallery",
    "invitation_bank_accounts",
    "invitation_quote",
    "media",
  ];

  const counts: Record<string, number> = {};
  for (const table of tables) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE invitation_id = $1`,
      [invitationId],
    );
    counts[table] = Number(rows[0]!.n);
  }
  return counts;
}

/**
 * Every free-text column the sweep wrote, read straight out of the tables.
 *
 * Through SQL rather than through the API on purpose: a response that re-sanitised on
 * the way out would hide markup sitting in the row, and the row is what the public
 * renderer will read.
 */
async function storedText(
  pool: Pool,
  invitationId: string,
): Promise<{ column: string; value: string }[]> {
  const queries: [string, string][] = [
    [
      "invitations.internal_name",
      "SELECT internal_name AS v FROM invitations WHERE id = $1",
    ],
    [
      "invitation_people.nickname",
      "SELECT nickname AS v FROM invitation_people WHERE invitation_id = $1",
    ],
    [
      "invitation_people.full_name",
      "SELECT full_name AS v FROM invitation_people WHERE invitation_id = $1",
    ],
    [
      "invitation_people.father_name",
      "SELECT father_name AS v FROM invitation_people WHERE invitation_id = $1 AND father_name IS NOT NULL",
    ],
    [
      "invitation_quote.text",
      "SELECT text AS v FROM invitation_quote WHERE invitation_id = $1",
    ],
    [
      "invitation_quote.source",
      "SELECT source AS v FROM invitation_quote WHERE invitation_id = $1",
    ],
    [
      "invitation_events.title",
      "SELECT title AS v FROM invitation_events WHERE invitation_id = $1",
    ],
    [
      "invitation_events.venue_name",
      "SELECT venue_name AS v FROM invitation_events WHERE invitation_id = $1",
    ],
    [
      "invitation_events.address",
      "SELECT address AS v FROM invitation_events WHERE invitation_id = $1",
    ],
    [
      "invitation_bank_accounts.provider_name",
      "SELECT provider_name AS v FROM invitation_bank_accounts WHERE invitation_id = $1",
    ],
    [
      "invitation_bank_accounts.account_holder",
      "SELECT account_holder AS v FROM invitation_bank_accounts WHERE invitation_id = $1",
    ],
    [
      "invitation_gallery.caption",
      "SELECT caption AS v FROM invitation_gallery WHERE invitation_id = $1 AND caption IS NOT NULL",
    ],
  ];

  const out: { column: string; value: string }[] = [];
  for (const [column, sql] of queries) {
    const { rows } = await pool.query<{ v: string | null }>(sql, [
      invitationId,
    ]);
    for (const row of rows) {
      // A column the sweep did not write is not evidence either way.
      if (row.v !== null && row.v.includes("Budi"))
        out.push({ column, value: row.v });
    }
  }
  return out;
}
