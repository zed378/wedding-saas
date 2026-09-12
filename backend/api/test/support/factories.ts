import type { Pool } from "pg";

import { assertValidTemplateVersion } from "@wi/schema";

import {
  tenantScope,
  type TenantScope,
} from "../../src/shared/tenancy/tenant-scope";

/**
 * Test data factories. `docs/TESTING/02` § Test Data Factory.
 *
 * The document's reasoning is worth repeating because it is the whole justification for
 * this file: factories make "complex scenarios easier (e.g., 2 users each with their own
 * invitation for an IDOR test)".
 *
 * That is not a convenience argument. `docs/SECURITY/05` requires an IDOR test for
 * **every** `:id` endpoint, with zero tolerance for regressions. If setting up two
 * tenants takes twenty lines, some of those tests will not get written — not through
 * negligence, but because the twentieth endpoint is being added at 5pm and the setup is
 * tedious. `createTwoTenants()` exists to make the cost of that test one line.
 */

let counter = 0;
/** Unique per call, so a leftover row from a failed run cannot make a later one pass. */
const uniq = (): string =>
  `${Date.now()}-${(counter += 1)}-${Math.random().toString(36).slice(2, 6)}`;

export interface TestUser {
  readonly id: string;
  readonly email: string;
  /** Ready to pass to the `P0-11` repository. Saves every test constructing it. */
  readonly scope: TenantScope;
}

export interface TestTemplateVersion {
  readonly templateId: string;
  readonly versionId: string;
}

export interface TestInvitation {
  readonly id: string;
  readonly ownerId: string;
  readonly templateId: string;
  readonly templateVersionId: string;
}

export async function createTestUser(
  pool: Pool,
  overrides: { email?: string; role?: string; fullName?: string } = {},
): Promise<TestUser> {
  const email = overrides.email ?? `user-${uniq()}@example.test`;
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO users (email, full_name, role) VALUES ($1, $2, $3) RETURNING id",
    [email, overrides.fullName ?? "Test User", overrides.role ?? "user"],
  );
  return { id: rows[0]!.id, email, scope: tenantScope(rows[0]!.id) };
}

/**
 * A minimal template version that the `P0-20` validator accepts.
 *
 * Before `P0-20` this factory wrote `{ "--color-primary": "#b76e79" }` as a theme and a
 * section with no `configurable` key -- neither of which is a shape anything can render.
 * It did not matter while nothing read the column; it would have mattered the moment
 * something did, and every integration test would have been carrying invalid data.
 */
const DEFAULT_SECTIONS = [
  {
    section_key: "hero",
    component: "HeroClassic",
    enabled_by_default: true,
    configurable: false,
    required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
  },
];

const DEFAULT_THEME = {
  colors: {
    primary: "#b76e79",
    secondary: "#f4ede4",
    accent: "#c9a876",
    text: "#2b2b2b",
  },
  typography: {
    heading_font: "Playfair Display",
    body_font: "Lato",
    scale: "default",
  },
  spacing: "comfortable",
  border_radius: "rounded",
};

export async function createTestTemplateVersion(
  pool: Pool,
  overrides: {
    version?: string;
    sections?: unknown;
    theme?: unknown;
    customizableThemeKeys?: readonly string[];
    /**
     * Add a version to an EXISTING template rather than creating a new one.
     *
     * Added by `P1-09`, which needs two published versions of one template to prove BR-3.1
     * -- that a later version does not move an invitation that already locked an earlier
     * one. Without this the factory can only ever produce unrelated templates, and the
     * rule would be untestable through it.
     */
    templateId?: string;
  } = {},
): Promise<TestTemplateVersion> {
  // docs/DATABASE/03 § Schema Validation: validated before being saved. A factory that
  // wrote definitions the validator rejects would be a fixture generator for a state
  // the application cannot produce.
  const definition = assertValidTemplateVersion({
    sections: overrides.sections ?? DEFAULT_SECTIONS,
    theme: overrides.theme ?? DEFAULT_THEME,
    customizable_theme_keys: overrides.customizableThemeKeys ?? [
      "colors.primary",
    ],
  });

  const templateId =
    overrides.templateId ??
    (
      await pool.query<{ id: string }>(
        "INSERT INTO templates (slug, name, status) VALUES ($1, 'Test Template', 'published') RETURNING id",
        [`tpl-${uniq()}`],
      )
    ).rows[0]!.id;

  const { rows: v } = await pool.query<{ id: string }>(
    `INSERT INTO template_versions (template_id, version, sections, theme, customizable_theme_keys, status)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, 'published') RETURNING id`,
    [
      templateId,
      overrides.version ?? "1.0.0",
      JSON.stringify(definition.sections),
      JSON.stringify(definition.theme),
      definition.customizable_theme_keys,
    ],
  );
  return { templateId, versionId: v[0]!.id };
}

export async function createTestInvitation(
  pool: Pool,
  options: {
    owner: TestUser | string;
    template?: TestTemplateVersion;
    status?: string;
    slug?: string;
    internalName?: string;
  },
): Promise<TestInvitation> {
  const ownerId =
    typeof options.owner === "string" ? options.owner : options.owner.id;
  const template = options.template ?? (await createTestTemplateVersion(pool));

  const columns: string[] = ["owner_id", "template_id", "template_version_id"];
  const values: unknown[] = [ownerId, template.templateId, template.versionId];

  if (options.status !== undefined) {
    columns.push("status");
    values.push(options.status);
  }
  if (options.slug !== undefined) {
    columns.push("slug");
    values.push(options.slug);
  }
  if (options.internalName !== undefined) {
    columns.push("internal_name");
    values.push(options.internalName);
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO invitations (${columns.join(", ")})
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    values,
  );

  return {
    id: rows[0]!.id,
    ownerId,
    templateId: template.templateId,
    templateVersionId: template.versionId,
  };
}

export async function createTestOrder(
  pool: Pool,
  options: {
    invitation: TestInvitation;
    user: TestUser | string;
    status?: string;
    amount?: bigint;
  },
): Promise<{ id: string }> {
  const userId =
    typeof options.user === "string" ? options.user : options.user.id;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO orders (invitation_id, user_id, package_id, amount_total, status, expired_at)
     VALUES ($1, $2, 'standard', $3, $4, now() + interval '1 day') RETURNING id`,
    [
      options.invitation.id,
      userId,
      String(options.amount ?? 139000n),
      options.status ?? "pending",
    ],
  );
  return { id: rows[0]!.id };
}

export async function createTestMedia(
  pool: Pool,
  options: {
    invitation?: TestInvitation;
    uploadedBy?: TestUser | string;
    status?: string;
  } = {},
): Promise<{ id: string }> {
  const uploadedBy =
    options.uploadedBy === undefined
      ? null
      : typeof options.uploadedBy === "string"
        ? options.uploadedBy
        : options.uploadedBy.id;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO media (invitation_id, uploaded_by, purpose, status, storage_path)
     VALUES ($1, $2, 'gallery', $3, $4) RETURNING id`,
    [
      options.invitation?.id ?? null,
      uploadedBy,
      options.status ?? "ready",
      `uploads/${uniq()}`,
    ],
  );
  return { id: rows[0]!.id };
}

export interface TwoTenants {
  /** The tenant whose data is being protected. */
  readonly alice: { user: TestUser; invitation: TestInvitation };
  /** The tenant attempting to reach it. */
  readonly mallory: { user: TestUser; invitation: TestInvitation };
}

/**
 * Two users, each with a complete invitation. The starting point for every IDOR test.
 *
 * `P0-19` step 4 calls this out specifically, and the reasoning in the card is exactly
 * right: "making it a one-liner is the difference between the tests being written and
 * being skipped."
 *
 * The names are deliberate. `alice` and `mallory` are the cryptography convention for
 * "the honest party" and "the active attacker", so a test reading
 * `findOwned(alice.invitation.id, mallory.user.scope)` states the attack in its own
 * arguments — no comment required to explain which side is which.
 *
 * Each gets their **own** template version too. Sharing one would be cheaper and would
 * hide a real class of bug: a query that filters by template rather than by owner would
 * pass a shared-template test and leak in production.
 */
export async function createTwoTenants(pool: Pool): Promise<TwoTenants> {
  const aliceUser = await createTestUser(pool, { fullName: "Alice" });
  const malloryUser = await createTestUser(pool, { fullName: "Mallory" });

  return {
    alice: {
      user: aliceUser,
      invitation: await createTestInvitation(pool, {
        owner: aliceUser,
        internalName: "Alice's wedding",
      }),
    },
    mallory: {
      user: malloryUser,
      invitation: await createTestInvitation(pool, {
        owner: malloryUser,
        internalName: "Mallory's wedding",
      }),
    },
  };
}
