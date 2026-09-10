import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * These tests need no database. They pin the assumptions that the migration tooling
 * is built on, so that when one of them stops being true it fails here rather than
 * during a release.
 *
 * The round trip against a real database is scripts/db-roundtrip.sh — it needs a
 * running container, which the test harness does not have until P0-19 brings
 * Testcontainers.
 */

const MIGRATIONS = path.resolve(__dirname, "../migrations");

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function journal(): JournalEntry[] {
  const raw = fs.readFileSync(
    path.join(MIGRATIONS, "meta", "_journal.json"),
    "utf8",
  );
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

describe("migration files", () => {
  it("every migration in the journal has a down file", () => {
    // Drizzle generates no down migrations (ADR-030), so the companion file is
    // written by hand and is exactly the kind of thing that gets forgotten. The
    // absence only surfaces when someone tries to roll back, which is the worst
    // moment to find out.
    const missing = journal()
      .map((e) => e.tag)
      .filter(
        (tag) => !fs.existsSync(path.join(MIGRATIONS, `${tag}.down.sql`)),
      );

    expect(missing).toEqual([]);
  });

  it("has no down file left behind by a deleted migration", () => {
    const tags = new Set(journal().map((e) => e.tag));
    const orphans = fs
      .readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".down.sql"))
      .map((f) => f.replace(/\.down\.sql$/, ""))
      .filter((tag) => !tags.has(tag));

    expect(orphans).toEqual([]);
  });

  it("the baseline creates set_updated_at and its down migration removes it", () => {
    const up = fs.readFileSync(
      path.join(MIGRATIONS, "0000_baseline.sql"),
      "utf8",
    );
    const down = fs.readFileSync(
      path.join(MIGRATIONS, "0000_baseline.down.sql"),
      "utf8",
    );

    expect(up).toMatch(/CREATE OR REPLACE FUNCTION set_updated_at\(\)/);
    expect(down).toMatch(/DROP FUNCTION IF EXISTS set_updated_at\(\)/);
  });

  it("the baseline creates no extension", () => {
    // gen_random_uuid() is core since PostgreSQL 13 and this project runs 18, so
    // pgcrypto is unnecessary -- and CREATE EXTENSION needs superuser, which the
    // migration role should not have to keep for nothing. If a later migration
    // genuinely needs an extension it will add one and this test moves to it.
    const up = fs.readFileSync(
      path.join(MIGRATIONS, "0000_baseline.sql"),
      "utf8",
    );
    const withoutComments = up.replace(/--[^\n]*/g, "");

    expect(withoutComments).not.toMatch(/CREATE\s+EXTENSION/i);
  });
});

describe("drizzle bookkeeping assumptions", () => {
  /**
   * src/infra/db/rollback.mts reads drizzle.__drizzle_migrations directly and maps
   * its `created_at` to the journal's `when` to find which file to reverse. That
   * couples us to Drizzle's internals, so the coupling is pinned here: if an upgrade
   * changes the table or the journal shape, this fails instead of the rollback
   * silently reversing the wrong migration.
   */
  it("the journal entry shape is what rollback relies on", () => {
    for (const entry of journal()) {
      expect(typeof entry.tag).toBe("string");
      expect(typeof entry.when).toBe("number");
      // The mapping is created_at -> String(when), so `when` must survive that trip
      // without precision loss or exponent notation.
      expect(String(entry.when)).toMatch(/^\d+$/);
    }
  });

  it("drizzle still writes the migrations table this project reads", () => {
    // Read from the installed package rather than restating it from memory: the
    // point is to notice a change in the dependency, which a hard-coded copy of the
    // DDL here would not do.
    //
    // Resolved from the public "drizzle-orm/pg-core" entry point and then walked
    // sideways, because the "exports" map exposes neither dialect.js nor
    // package.json. Reaching past the public surface is the price of depending on
    // an internal, and is exactly why this test exists.
    const entry = require.resolve("drizzle-orm/pg-core");
    const dialect = path.join(path.dirname(entry), "dialect.js");

    expect(fs.existsSync(dialect)).toBe(true);
    const source = fs.readFileSync(dialect, "utf8");

    expect(source).toContain("__drizzle_migrations");
    expect(source).toContain("drizzle");
    expect(source).toMatch(/hash text NOT NULL/);
    expect(source).toMatch(/created_at bigint/);
  });
});
