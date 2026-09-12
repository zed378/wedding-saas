import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  ChangeTemplateService,
  dropThemeKeys,
  recomputeSections,
} from "../../src/modules/invitation/change-template.service";
import { AuditLogService } from "../../src/shared/audit/audit-log.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { invitations } from "../../src/infra/db/schema/invitations";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import {
  createTestInvitation,
  createTestTemplateVersion,
  createTestUser,
  type TestTemplateVersion,
  type TestUser,
} from "../support/factories";
import { expectServiceIdorSafe } from "../support/idor";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-15 — changing a template without losing data. BR-3.1, BR-4.1, `docs/PLAN/07`
 * § Template Compatibility & Migration.
 *
 * The suite is organised around the one claim the card makes: **nothing is deleted**.
 * `docs/PLAN/17` line 8 makes it an acceptance criterion for the whole product — "users can
 * switch templates without losing data, tested with a scenario where fields disappear and
 * reappear" — so the round trip below is the acceptance test, not only a unit test.
 *
 * An absence is the hardest thing to keep. A `DELETE FROM invitation_gallery` added here in
 * two years would look like tidying up after a section that "is not used any more", and
 * nothing in a diff would say otherwise. Hence three independent guards: a row-count
 * assertion across every child table, a row-for-row equality assertion after a round trip,
 * and a source-level check that the code path contains no delete at all.
 */

/** Template A: a hero that cannot be switched off, plus a gallery and a gift section. */
const SECTIONS_A = [
  {
    section_key: "hero",
    component: "HeroClassic",
    enabled_by_default: true,
    configurable: false,
    required_fields: ["couple.groom.nickname"],
  },
  {
    section_key: "gallery",
    component: "GalleryGrid",
    enabled_by_default: true,
    configurable: true,
    required_fields: [],
  },
  {
    section_key: "gift",
    component: "GiftAccountList",
    enabled_by_default: true,
    configurable: true,
    required_fields: [],
  },
];

/** Template B shares only `hero`. Its `quote` is new; its `closing` is off by default. */
const SECTIONS_B = [
  {
    section_key: "hero",
    component: "HeroClassic",
    enabled_by_default: true,
    configurable: false,
    required_fields: ["couple.groom.nickname"],
  },
  {
    section_key: "quote",
    component: "QuoteBanner",
    enabled_by_default: true,
    configurable: true,
    required_fields: [],
  },
  {
    section_key: "closing",
    component: "ClosingSimple",
    enabled_by_default: false,
    configurable: true,
    required_fields: [],
  },
];

const THEME = {
  colors: {
    primary: "#b76e79",
    secondary: "#f4ede4",
    accent: "#c9a876",
    text: "#2b2b2b",
  },
  typography: {
    heading_font: "Playfair Display",
    body_font: "Inter",
    scale: "default",
  },
  spacing: "comfortable",
  border_radius: "rounded",
};

/** Every table that holds invitation content. None of them may lose a row. */
const CHILD_TABLES = [
  "invitation_people",
  "invitation_events",
  "invitation_gallery",
  "invitation_bank_accounts",
  "invitation_quote",
  "invitation_guests",
  "invitation_guestbook",
] as const;

describe("changing a template without losing data", () => {
  let harness: Harness;
  let service: ChangeTemplateService;
  let repository: InvitationRepository;

  beforeAll(async () => {
    harness = await startHarness();
    repository = new InvitationRepository(harness.db);
    service = new ChangeTemplateService(
      harness.db,
      repository,
      new AuditLogService(),
    );
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
  });

  const templateWith = (
    sections: unknown,
    customizableThemeKeys: readonly string[] = ["colors.primary"],
  ): Promise<TestTemplateVersion> =>
    createTestTemplateVersion(harness.pool, {
      sections,
      theme: THEME,
      customizableThemeKeys,
    });

  /** An invitation on template A, with a known section selection and theme override. */
  const onTemplateA = async (
    options: {
      enabledSections?: readonly string[];
      themeOverride?: Record<string, unknown>;
      customizableThemeKeys?: readonly string[];
      status?: string;
    } = {},
  ): Promise<{
    user: TestUser;
    invitationId: string;
    templateA: TestTemplateVersion;
  }> => {
    const user = await createTestUser(harness.pool);
    const templateA = await templateWith(
      SECTIONS_A,
      options.customizableThemeKeys ?? ["colors.primary", "colors.accent"],
    );
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
      template: templateA,
      ...(options.status !== undefined ? { status: options.status } : {}),
    });

    await harness.pool.query(
      `INSERT INTO invitation_settings (invitation_id, enabled_sections, theme_override)
       VALUES ($1, $2, $3::jsonb)`,
      [
        invitation.id,
        options.enabledSections ?? ["hero", "gallery", "gift"],
        JSON.stringify(options.themeOverride ?? {}),
      ],
    );

    return { user, invitationId: invitation.id, templateA };
  };

  /** Content in every child table, so "nothing was deleted" has something to be about. */
  const seedContent = async (
    invitationId: string,
    user: TestUser,
  ): Promise<void> => {
    // Inline rather than through `createTestMedia`, which takes a whole `TestInvitation`.
    // A gallery photo must belong to the invitation it is on, so `invitation_id` is set.
    const { rows: mediaRows } = await harness.pool.query<{ id: string }>(
      `INSERT INTO media (invitation_id, uploaded_by, purpose, status, storage_path)
       VALUES ($1, $2, 'gallery', 'ready', $3) RETURNING id`,
      [invitationId, user.id, `uploads/${invitationId}`],
    );
    const media = mediaRows[0]!;

    await harness.pool.query(
      `INSERT INTO invitation_people (invitation_id, role, full_name, nickname)
       VALUES ($1, 'groom', 'Budi Santoso', 'Budi'), ($1, 'bride', 'Ani Wijaya', 'Ani')`,
      [invitationId],
    );
    await harness.pool.query(
      `INSERT INTO invitation_events (invitation_id, type, title, event_date, start_time, venue_name, address)
       VALUES ($1, 'akad', 'Akad Nikah', '2026-11-20', '08:00', 'Masjid Agung', 'Jl. Merdeka 1')`,
      [invitationId],
    );
    await harness.pool.query(
      `INSERT INTO invitation_gallery (invitation_id, media_id, caption, display_order, is_cover)
       VALUES ($1, $2, 'Prewedding di pantai', 0, true)`,
      [invitationId, media.id],
    );
    await harness.pool.query(
      `INSERT INTO invitation_bank_accounts (invitation_id, type, provider_name, account_number, account_holder)
       VALUES ($1, 'bank', 'BCA', '1234567890', 'Budi Santoso')`,
      [invitationId],
    );
    await harness.pool.query(
      `INSERT INTO invitation_quote (invitation_id, text, source) VALUES ($1, 'Ar-Rum 21', 'Al-Quran')`,
      [invitationId],
    );
    await harness.pool.query(
      `INSERT INTO invitation_guests (invitation_id, guest_name, attendance_status)
       VALUES ($1, 'Rina', 'attending')`,
      [invitationId],
    );
    await harness.pool.query(
      `INSERT INTO invitation_guestbook (invitation_id, guest_name, message)
       VALUES ($1, 'Rina', 'Selamat menempuh hidup baru!')`,
      [invitationId],
    );
  };

  /** Every content row of an invitation, ordered, as comparable JSON. */
  const contentSnapshot = async (
    invitationId: string,
  ): Promise<Record<string, unknown[]>> => {
    const snapshot: Record<string, unknown[]> = {};
    for (const table of CHILD_TABLES) {
      const { rows } = await harness.pool.query(
        `SELECT * FROM ${table} WHERE invitation_id = $1 ORDER BY 1`,
        [invitationId],
      );
      snapshot[table] = rows;
    }
    return snapshot;
  };

  const settingsOf = async (
    invitationId: string,
  ): Promise<{
    enabled_sections: string[];
    theme_override: Record<string, unknown>;
  }> => {
    const { rows } = await harness.pool.query<{
      enabled_sections: string[];
      theme_override: Record<string, unknown>;
    }>(
      "SELECT enabled_sections, theme_override FROM invitation_settings WHERE invitation_id = $1",
      [invitationId],
    );
    return rows[0]!;
  };

  // ------------------------------------------------------------ the happy path

  describe("the change itself", () => {
    it("moves template_id and template_version_id to the new template's published version", async () => {
      const { user, invitationId } = await onTemplateA();
      const templateB = await templateWith(SECTIONS_B);

      const result = await service.change(
        user.scope,
        invitationId,
        templateB.templateId,
      );

      expect(result.template_id).toBe(templateB.templateId);
      expect(result.template_version_id).toBe(templateB.versionId);

      const [row] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitationId));

      expect(row!.templateId).toBe(templateB.templateId);
      expect(row!.templateVersionId).toBe(templateB.versionId);
    });

    it("locks the newest published version, not a draft one (BR-3.1, BR-3.3)", async () => {
      // A template with two versions: the published one is what an invitation may move to,
      // and a draft published later must not be reachable by any request shape.
      const { user, invitationId } = await onTemplateA();
      const templateB = await templateWith(SECTIONS_B);
      await harness.pool.query(
        `INSERT INTO template_versions (template_id, version, sections, theme, customizable_theme_keys, status)
         VALUES ($1, '9.9.9', $2::jsonb, $3::jsonb, '{}', 'draft')`,
        [
          templateB.templateId,
          JSON.stringify(SECTIONS_B),
          JSON.stringify(THEME),
        ],
      );

      const result = await service.change(
        user.scope,
        invitationId,
        templateB.templateId,
      );

      expect(result.template_version_id).toBe(templateB.versionId);
    });

    it("a template whose only version is a draft is refused", async () => {
      const { user, invitationId } = await onTemplateA();
      const { rows } = await harness.pool.query<{ id: string }>(
        "INSERT INTO templates (slug, name, status) VALUES ($1, 'Unpublished', 'draft') RETURNING id",
        [`tpl-draft-${Date.now()}`],
      );
      const draftOnly = rows[0]!.id;

      const error = await rejection(() =>
        service.change(user.scope, invitationId, draftOnly),
      );

      expect(error).toMatchObject({ code: "TEMPLATE_NOT_AVAILABLE" });
    });

    it("an unknown template id is 404", async () => {
      const { user, invitationId } = await onTemplateA();

      const error = await rejection(() =>
        service.change(
          user.scope,
          invitationId,
          "00000000-0000-4000-8000-000000000000",
        ),
      );

      expect(error).toMatchObject({ status: 404 });
    });

    it("changing to the template already in use is refused", async () => {
      // Not a silent success: the response's whole purpose is to describe a change, and
      // re-resolving the version here would make this a covert upgrade-template-version,
      // which docs/API/04 deliberately keeps as a separate endpoint with its own warning.
      const { user, invitationId, templateA } = await onTemplateA();

      const error = await rejection(() =>
        service.change(user.scope, invitationId, templateA.templateId),
      );

      expect(error).toMatchObject({ code: "TEMPLATE_UNCHANGED" });
    });
  });

  // ------------------------------------------------------------ BR-4.1, no loss

  describe("nothing is deleted (BR-4.1)", () => {
    it("keeps every content row when the new template has no gallery or gift section", async () => {
      const { user, invitationId } = await onTemplateA();
      await seedContent(invitationId, user);
      const before = await contentSnapshot(invitationId);
      const templateB = await templateWith(SECTIONS_B);

      const result = await service.change(
        user.scope,
        invitationId,
        templateB.templateId,
      );

      expect(result.hidden_sections.sort()).toEqual(["gallery", "gift"]);
      expect(await contentSnapshot(invitationId)).toEqual(before);
    });

    it("the round trip A -> B -> A restores the full rendering", async () => {
      // docs/PLAN/17 line 8, verbatim: "tested with a scenario where fields disappear and
      // reappear". This is that scenario.
      const { user, invitationId, templateA } = await onTemplateA();
      await seedContent(invitationId, user);
      const before = await contentSnapshot(invitationId);
      const templateB = await templateWith(SECTIONS_B);

      await service.change(user.scope, invitationId, templateB.templateId);
      const hidden = await settingsOf(invitationId);
      expect(hidden.enabled_sections).not.toContain("gallery");

      const back = await service.change(
        user.scope,
        invitationId,
        templateA.templateId,
      );

      expect(back.enabled_sections).toEqual(["hero", "gallery", "gift"]);
      expect(back.hidden_sections).toEqual(["quote"]);
      // Row for row, column for column, including the ids the gallery photos had before.
      expect(await contentSnapshot(invitationId)).toEqual(before);
    });

    it("the code path contains no delete statement at all", async () => {
      // The card's first DoD item, made mechanical. An absence cannot be read off a diff
      // six months from now, and "we would notice a DELETE in review" is exactly the kind
      // of discipline this repository has twice found to be worth nothing.
      const source = stripComments(
        readFileSync(
          resolve(
            __dirname,
            "../../src/modules/invitation/change-template.service.ts",
          ),
          "utf8",
        ),
      );
      expect(source).not.toMatch(/\bdelete\b/i);

      const method = extractMethod(
        stripComments(
          readFileSync(
            resolve(
              __dirname,
              "../../src/shared/tenancy/invitation-repository.ts",
            ),
            "utf8",
          ),
        ),
        "changeTemplate",
      );
      expect(method).not.toMatch(/\bdelete\b/i);
      // Proof the extraction found the real method rather than an empty string that would
      // satisfy the assertion above no matter what.
      expect(method).toContain("invitationSettings");
    });
  });

  // ------------------------------------------------------- the recomputed list

  describe("the section selection", () => {
    it("carries what both templates define and adds what is new", async () => {
      const { user, invitationId } = await onTemplateA();
      const templateB = await templateWith(SECTIONS_B);

      const result = await service.change(
        user.scope,
        invitationId,
        templateB.templateId,
      );

      // `hero` survives; `quote` is new and defaults on; `closing` is new and defaults off.
      expect(result.enabled_sections).toEqual(["hero", "quote"]);
    });

    it("a section the user turned off stays off when the new template also has it", async () => {
      // The difference between "the old template did not have it" and "the user did not
      // want it". Getting this wrong is the bug a user notices immediately: they switch
      // template and the gallery they deliberately hid is back on the page.
      const { user, invitationId } = await onTemplateA({
        enabledSections: ["hero", "gift"],
      });
      const sharesGallery = [
        ...SECTIONS_A,
        {
          section_key: "guestbook",
          component: "GuestbookWall",
          enabled_by_default: true,
          configurable: true,
          required_fields: [],
        },
      ];
      const templateC = await templateWith(sharesGallery);

      const result = await service.change(
        user.scope,
        invitationId,
        templateC.templateId,
      );

      expect(result.enabled_sections).not.toContain("gallery");
      expect(result.enabled_sections).toContain("guestbook");
    });

    it("a non-configurable section of the new template is forced on", async () => {
      // P1-14 refuses to let anyone disable one, so a recomputed selection that omitted a
      // structural section would be a state the API cannot produce and cannot repair:
      // every later settings save 422s with SECTION_NOT_CONFIGURABLE on a value the server
      // itself wrote. It also renders an invitation with no hero, which is a blank page.
      const { user, invitationId } = await onTemplateA({
        enabledSections: ["hero"],
      });
      // `enabled_by_default` stays true: P0-20's validator refuses a non-configurable
      // section that defaults off, because it can never take effect. The state under test
      // is still reachable — template A's gallery IS configurable, so the user could turn
      // it off there, and template D then makes the same key structural.
      const structuralGallery = SECTIONS_A.map((section) =>
        section.section_key === "gallery"
          ? { ...section, configurable: false }
          : section,
      );
      const templateD = await templateWith(structuralGallery);

      const result = await service.change(
        user.scope,
        invitationId,
        templateD.templateId,
      );

      expect(result.enabled_sections).toContain("gallery");
    });

    it("the recomputed selection is always valid under the new template", async () => {
      const { user, invitationId } = await onTemplateA();
      const templateB = await templateWith(SECTIONS_B);

      const result = await service.change(
        user.scope,
        invitationId,
        templateB.templateId,
      );

      const defined = new Set(SECTIONS_B.map((s) => s.section_key));
      for (const key of result.enabled_sections) {
        expect(defined.has(key)).toBe(true);
      }
      expect(new Set(result.enabled_sections).size).toBe(
        result.enabled_sections.length,
      );
    });

    it("is stored, not only returned", async () => {
      const { user, invitationId } = await onTemplateA();
      const templateB = await templateWith(SECTIONS_B);

      const result = await service.change(
        user.scope,
        invitationId,
        templateB.templateId,
      );

      expect((await settingsOf(invitationId)).enabled_sections).toEqual(
        result.enabled_sections,
      );
    });
  });

  // -------------------------------------------------------------- theme keys

  describe("theme overrides", () => {
    it("drops what the new template does not permit, and says so", async () => {
      const { user, invitationId } = await onTemplateA({
        themeOverride: { colors: { primary: "#ffffff", accent: "#000000" } },
      });
      const templateB = await templateWith(SECTIONS_B, ["colors.primary"]);

      const result = await service.change(
        user.scope,
        invitationId,
        templateB.templateId,
      );

      expect(result.dropped_theme_keys).toEqual(["colors.accent"]);
      expect((await settingsOf(invitationId)).theme_override).toEqual({
        colors: { primary: "#ffffff" },
      });
    });

    it("keeps everything when the new template permits the same keys", async () => {
      const { user, invitationId } = await onTemplateA({
        themeOverride: { colors: { primary: "#ffffff" } },
      });
      const templateB = await templateWith(SECTIONS_B, [
        "colors.primary",
        "colors.accent",
      ]);

      const result = await service.change(
        user.scope,
        invitationId,
        templateB.templateId,
      );

      expect(result.dropped_theme_keys).toEqual([]);
      expect((await settingsOf(invitationId)).theme_override).toEqual({
        colors: { primary: "#ffffff" },
      });
    });
  });

  // ------------------------------------------------------------- the audit row

  describe("the trail", () => {
    it("records the change with both states, in the same transaction", async () => {
      // Card step 6: so support can answer "why did my gallery disappear".
      const { user, invitationId, templateA } = await onTemplateA();
      const templateB = await templateWith(SECTIONS_B);

      await service.change(user.scope, invitationId, templateB.templateId);

      const { rows } = await harness.pool.query<{
        admin_id: string;
        action: string;
        resource_id: string;
        reason: string;
        before_state: Record<string, unknown>;
        after_state: Record<string, unknown>;
      }>("SELECT * FROM audit_logs WHERE resource_id = $1", [invitationId]);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.action).toBe("invitation.change_template");
      expect(rows[0]!.admin_id).toBe(user.id);
      expect(rows[0]!.reason).toContain("gallery");
      expect(rows[0]!.before_state).toMatchObject({
        template_id: templateA.templateId,
      });
      expect(rows[0]!.after_state).toMatchObject({
        template_id: templateB.templateId,
      });
    });

    it("writes no audit row when the change is refused", async () => {
      const { user, invitationId, templateA } = await onTemplateA();

      await rejection(() =>
        service.change(user.scope, invitationId, templateA.templateId),
      );

      const { rows } = await harness.pool.query(
        "SELECT 1 FROM audit_logs WHERE resource_id = $1",
        [invitationId],
      );
      expect(rows).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------- IDOR

  describe("cross-tenant access (docs/SECURITY/05)", () => {
    it("a foreign scope cannot change my template, and mine does not move", async () => {
      const alice = await onTemplateA();
      const mallory = await onTemplateA();
      const templateB = await templateWith(SECTIONS_B);

      await expectServiceIdorSafe(() =>
        service.change(
          mallory.user.scope,
          alice.invitationId,
          templateB.templateId,
        ),
      );

      const [row] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, alice.invitationId));
      expect(row!.templateId).toBe(alice.templateA.templateId);
    });

    it("the repository refuses a foreign scope even when the service is bypassed", async () => {
      // P1-12's lesson: layered checks make each other untestable from the front door, so
      // the repository is exercised directly. Removing the owner predicate from
      // changeTemplate must fail HERE, where the service's requireOwnership cannot mask it.
      const alice = await onTemplateA();
      const mallory = await onTemplateA();
      const templateB = await templateWith(SECTIONS_B);

      const moved = await repository.changeTemplate(
        alice.invitationId,
        mallory.user.scope,
        {
          templateId: templateB.templateId,
          templateVersionId: templateB.versionId,
          enabledSections: ["hero"],
          themeOverride: {},
        },
        async () => {
          throw new Error("the audit callback must not run on a refused write");
        },
      );

      expect(moved).toBe(false);
      expect((await settingsOf(alice.invitationId)).enabled_sections).toEqual([
        "hero",
        "gallery",
        "gift",
      ]);
    });

    it("a soft-deleted invitation is 404", async () => {
      const { user, invitationId } = await onTemplateA();
      const templateB = await templateWith(SECTIONS_B);
      await harness.db
        .update(invitations)
        .set({ deletedAt: new Date() })
        .where(eq(invitations.id, invitationId));

      const error = await rejection(() =>
        service.change(user.scope, invitationId, templateB.templateId),
      );

      expect(error).toMatchObject({ status: 404 });
    });
  });

  // -------------------------------------------------------- the pure functions

  describe("recomputeSections", () => {
    const targets = SECTIONS_B;

    it("names what the new template does not define as hidden", () => {
      const { hidden } = recomputeSections(SECTIONS_A, targets, [
        "hero",
        "gallery",
        "gift",
      ]);
      expect(hidden).toEqual(["gallery", "gift"]);
    });

    it("returns the selection in the new template's own section order", () => {
      const { enabled } = recomputeSections(SECTIONS_A, targets, ["hero"]);
      expect(enabled).toEqual(["hero", "quote"]);
    });

    it("tolerates a malformed sections column on either side", () => {
      // The column is jsonb and these rows may predate any version of P0-20's validator.
      expect(recomputeSections(null, targets, ["hero"])).toEqual({
        enabled: ["hero", "quote"],
        hidden: [],
      });
      expect(recomputeSections(SECTIONS_A, "not an array", ["hero"])).toEqual({
        enabled: [],
        hidden: ["hero"],
      });
    });

    it("produces no duplicate even when a key is carried, new and structural at once", () => {
      const { enabled } = recomputeSections([], targets, ["hero", "hero"]);
      expect(enabled).toEqual(["hero", "quote"]);
    });
  });

  describe("dropThemeKeys", () => {
    it("compares keys exactly, so a parent does not grant a child", () => {
      const { kept, dropped } = dropThemeKeys({ colors: { primary: "#fff" } }, [
        "colors",
      ]);
      expect(kept).toEqual({});
      expect(dropped).toEqual(["colors.primary"]);
    });

    it("rebuilds the nested shape rather than flattening it", () => {
      const { kept } = dropThemeKeys(
        { colors: { primary: "#fff", accent: "#000" }, spacing: "tight" },
        ["colors.primary", "spacing"],
      );
      expect(kept).toEqual({ colors: { primary: "#fff" }, spacing: "tight" });
    });

    it("drops everything when the new template permits nothing", () => {
      const { kept, dropped } = dropThemeKeys({ spacing: "tight" }, []);
      expect(kept).toEqual({});
      expect(dropped).toEqual(["spacing"]);
    });
  });
});

/** Strip comments, so prose about deleting is not a false positive. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * The body of one class method, from its signature to the next member at the same
 * indentation. Crude, and sufficient: the file is Prettier-formatted, so every member of
 * `InvitationRepository` starts at exactly two spaces.
 */
function extractMethod(source: string, name: string): string {
  const start = source.indexOf(`  async ${name}(`);
  if (start === -1) return "";
  const rest = source.slice(start + 1);
  const end = rest.search(/\n {2}(?:async |private |public |\/\*\*)/);
  return end === -1 ? rest : rest.slice(0, end);
}
