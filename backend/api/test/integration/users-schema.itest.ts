import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";

/**
 * P0-07 — the constraints on the users tables, proven by violating them.
 *
 * The `P0-07` Definition of Done says constraint behaviour must be proven by
 * integration tests "not by reading the migration", and that wording is the whole
 * reason this file exists. A CHECK that was never applied looks exactly like one that
 * was, from the migration file. The only evidence that a constraint is in force is a
 * write that it refuses.
 *
 * Needs a real database. `P0-19` brings Testcontainers; until then this runs against
 * the compose stack and FAILS rather than skips when nothing is reachable — a suite
 * that silently skips reports green for a schema nobody checked.
 *
 *   docker compose -f deploy/docker-compose.yml up -d postgres
 *   pnpm --filter @wi/api test:integration
 */

const URL =
  process.env["MIGRATION_DATABASE_URL"] ??
  "postgres://wedding_owner:wedding_owner_dev@localhost:5432/wedding";

let pool: Pool;

/** Unique per run so a leftover row from a failed run cannot make a later one pass. */
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function insertUser(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const row = {
    email: `user-${tag()}@example.test`,
    full_name: "Test User",
    ...overrides,
  } as Record<string, unknown>;

  const cols = Object.keys(row);
  const params = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (${cols.join(", ")}) VALUES (${params.join(", ")}) RETURNING id`,
    Object.values(row),
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  pool = new Pool({ connectionString: URL, max: 4 });
  try {
    await pool.query("SELECT 1");
  } catch (cause) {
    throw new Error(
      [
        `Cannot reach PostgreSQL at ${URL.replace(/:[^:@]*@/, ":***@")}`,
        "",
        "These tests do not skip when the database is missing, on purpose: a skipped",
        "schema suite reports green for constraints nobody verified.",
        "",
        "  docker compose -f deploy/docker-compose.yml up -d postgres",
        "  pnpm --filter @wi/api db:migrate",
        "",
      ].join("\n"),
      { cause },
    );
  }

  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM information_schema.tables WHERE table_name = 'users'",
  );
  if (rows[0]?.n === "0") {
    throw new Error(
      "The users table does not exist. Run: pnpm --filter @wi/api db:migrate",
    );
  }
});

afterAll(async () => {
  await pool?.end();
});

beforeEach(async () => {
  // Cascades clear every child table, which is itself a small check on the FKs.
  await pool.query("DELETE FROM users");
});

describe("users — email uniqueness (ADR-031)", () => {
  it("rejects a duplicate email among active users", async () => {
    const email = `dup-${tag()}@example.test`;
    await insertUser({ email });

    await expect(insertUser({ email })).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("frees the email once the first account is soft-deleted", async () => {
    // The behaviour ADR-031 exists for. Under the document as originally written --
    // a column-level UNIQUE alongside the partial index -- this insert fails, and a
    // user who deleted their account could not register again until the hard delete
    // ran days later.
    const email = `reuse-${tag()}@example.test`;
    const first = await insertUser({ email });
    await pool.query("UPDATE users SET deleted_at = now() WHERE id = $1", [
      first,
    ]);

    const second = await insertUser({ email });
    expect(second).not.toBe(first);

    // Both rows exist; only one is active.
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM users WHERE email = $1",
      [email],
    );
    expect(rows[0]!.n).toBe("2");
  });

  it("still refuses a third active account on a twice-used email", async () => {
    // Guards the obvious wrong fix: dropping uniqueness altogether would pass the
    // test above and quietly allow two live accounts on one address.
    const email = `triple-${tag()}@example.test`;
    const first = await insertUser({ email });
    await pool.query("UPDATE users SET deleted_at = now() WHERE id = $1", [
      first,
    ]);
    await insertUser({ email });

    await expect(insertUser({ email })).rejects.toMatchObject({
      code: "23505",
    });
  });
});

describe("users — CHECK constraints", () => {
  it("rejects a role outside the allowed set", async () => {
    // The last line of defence behind every authorization check in the project.
    await expect(insertUser({ role: "superuser" })).rejects.toMatchObject({
      code: "23514",
    });
  });

  it.each(["user", "admin", "super_admin"])(
    "accepts the documented role %s",
    async (role) => {
      await expect(insertUser({ role })).resolves.toEqual(expect.any(String));
    },
  );

  it("rejects a status outside the allowed set", async () => {
    await expect(insertUser({ status: "deleted" })).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("defaults role to user, status to active and email_verified to false", async () => {
    const id = await insertUser();
    const { rows } = await pool.query(
      "SELECT role, status, email_verified, password_hash FROM users WHERE id = $1",
      [id],
    );
    expect(rows[0]).toEqual({
      role: "user",
      status: "active",
      email_verified: false,
      // Nullable, because an OAuth-only account has no password. A NOT NULL here
      // would force a placeholder hash that something would later try to verify.
      password_hash: null,
    });
  });
});

describe("cascade behaviour", () => {
  it("deletes refresh tokens when the user is hard-deleted", async () => {
    // A refresh token that outlives its user is a credential for an account that no
    // longer exists.
    const id = await insertUser();
    await pool.query(
      "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '7 days')",
      [id, "hash"],
    );

    await pool.query("DELETE FROM users WHERE id = $1", [id]);

    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM refresh_tokens WHERE user_id = $1",
      [id],
    );
    expect(rows[0]!.n).toBe("0");
  });

  it.each([
    [
      "user_notification_preferences",
      "INSERT INTO user_notification_preferences (user_id) VALUES ($1)",
    ],
    [
      "user_tokens",
      "INSERT INTO user_tokens (user_id, type, token_hash, expires_at) VALUES ($1, 'password_reset', 'h', now() + interval '1 hour')",
    ],
    [
      "user_mfa_factors",
      "INSERT INTO user_mfa_factors (user_id, secret_encrypted) VALUES ($1, '\\x00'::bytea)",
    ],
    [
      "user_recovery_codes",
      "INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, 'h')",
    ],
  ])("cascades %s away with its user", async (table, insert) => {
    const id = await insertUser();
    await pool.query(insert, [id]);
    await pool.query("DELETE FROM users WHERE id = $1", [id]);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} WHERE user_id = $1`,
      [id],
    );
    expect(rows[0]!.n).toBe("0");
  });

  it("refuses a refresh token for a user that does not exist", async () => {
    await expect(
      pool.query(
        "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (gen_random_uuid(), 'h', now())",
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
});

describe("user_tokens", () => {
  it("rejects a type outside the allowed set", async () => {
    const id = await insertUser();
    await expect(
      pool.query(
        "INSERT INTO user_tokens (user_id, type, token_hash, expires_at) VALUES ($1, 'magic_link', 'h', now())",
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects a duplicate token hash across different users", async () => {
    // idx_user_tokens_hash is unique globally, not per user: the hash is the lookup
    // key at redemption, so a collision would make redemption ambiguous.
    const a = await insertUser();
    const b = await insertUser();
    const insert =
      "INSERT INTO user_tokens (user_id, type, token_hash, expires_at) VALUES ($1, 'email_verification', 'same-hash', now() + interval '1 day')";

    await pool.query(insert, [a]);
    await expect(pool.query(insert, [b])).rejects.toMatchObject({
      code: "23505",
    });
  });
});

describe("user_mfa_factors", () => {
  it("allows many unconfirmed factors but only one confirmed per type", async () => {
    // The partial predicate is the design: an enrolment started and abandoned must
    // not occupy the slot and lock an admin out of ever enrolling again.
    const id = await insertUser({ role: "admin" });
    const insert =
      "INSERT INTO user_mfa_factors (user_id, secret_encrypted, confirmed_at) VALUES ($1, '\\x01'::bytea, $2)";

    await pool.query(insert, [id, null]);
    await pool.query(insert, [id, null]);
    await pool.query(insert, [id, new Date()]);

    await expect(pool.query(insert, [id, new Date()])).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("stores the secret as bytea, not text", async () => {
    const id = await insertUser();
    await pool.query(
      "INSERT INTO user_mfa_factors (user_id, secret_encrypted) VALUES ($1, '\\xdeadbeef'::bytea)",
      [id],
    );

    const { rows } = await pool.query<{ t: string }>(
      "SELECT data_type AS t FROM information_schema.columns WHERE table_name='user_mfa_factors' AND column_name='secret_encrypted'",
    );
    expect(rows[0]!.t).toBe("bytea");
  });
});

describe("updated_at trigger", () => {
  it.each(["users", "user_notification_preferences"])(
    "%s bumps updated_at on a real change and not on a no-op",
    async (table) => {
      const id = await insertUser();
      if (table === "user_notification_preferences") {
        await pool.query(
          "INSERT INTO user_notification_preferences (user_id) VALUES ($1)",
          [id],
        );
      }
      const key = table === "users" ? "id" : "user_id";
      const column = table === "users" ? "full_name" : "rsvp_email";

      const read = async () => {
        const { rows } = await pool.query<{ u: string }>(
          `SELECT updated_at::text AS u FROM ${table} WHERE ${key} = $1`,
          [id],
        );
        return rows[0]!.u;
      };

      const before = await read();

      // A genuine no-op: same value written back.
      await pool.query(
        `UPDATE ${table} SET ${column} = ${column} WHERE ${key} = $1`,
        [id],
      );
      expect(await read()).toBe(before);

      const changed = table === "users" ? "Renamed" : false;
      await pool.query(`UPDATE ${table} SET ${column} = $2 WHERE ${key} = $1`, [
        id,
        changed,
      ]);
      expect(await read()).not.toBe(before);
    },
  );
});

describe("privilege separation", () => {
  it("the application role cannot alter these tables", async () => {
    // docs/SECURITY/05 precondition: the connection that serves requests must not be
    // able to change the schema it queries. Verified from the failing side, because
    // that is the only direction that proves anything.
    const appPool = new Pool({
      connectionString: URL.replace(
        /\/\/[^@]+@/,
        "//wedding_app:wedding_app_dev@",
      ),
      max: 1,
    });
    try {
      await expect(pool.query("SELECT 1")).resolves.toBeTruthy();
      await expect(
        appPool.query("ALTER TABLE users ADD COLUMN backdoor text"),
      ).rejects.toThrow(/permission denied|must be owner/i);
      // It can still do its actual job.
      await expect(
        appPool.query("SELECT count(*) FROM users"),
      ).resolves.toBeTruthy();
    } finally {
      await appPool.end();
    }
  });
});
