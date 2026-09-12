import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  SettingsService,
  assertThemeKeysValid,
  parseSections,
} from "../../src/modules/invitation/settings.service";
import { SlugService } from "../../src/modules/invitation/slug.service";
import { InvitationRepository } from "../../src/shared/tenancy/invitation-repository";
import { invitations } from "../../src/infra/db/schema/invitations";
import { templateVersions } from "../../src/infra/db/schema/templates";
import { startHarness, type Harness } from "../support/harness";
import { rejection } from "../support/rejection";
import {
  createTestInvitation,
  createTestTemplateVersion,
  createTestUser,
  type TestUser,
} from "../support/factories";
import { createTwoTenants, expectServiceIdorSafe } from "../support/idor";
import { resetTenantData } from "./helpers.ts";

/**
 * P1-14 — settings and slug rules.
 *
 * The theme of this suite is that **a boundary that does not reject is not a boundary**.
 * A section key the template does not define, or a theme key outside
 * `customizable_theme_keys`, must be refused rather than stored and ignored — because
 * stored-and-ignored is the failure that looks like success: the API returns 200, the page
 * does not change, and nothing anywhere says why.
 */

/**
 * Two sections: one the user may toggle, one structural. `docs/PLAN/07` § Section System
 * writes `configurable: true` explicitly for the toggleable kind.
 */
const SECTIONS = [
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

describe("settings and slug rules", () => {
  let harness: Harness;
  let service: SettingsService;
  let repository: InvitationRepository;

  beforeAll(async () => {
    harness = await startHarness();
    repository = new InvitationRepository(harness.db);
    service = new SettingsService(
      repository,
      new SlugService(harness.db, repository),
    );
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await resetTenantData(harness.pool);
    await harness.pool.query("DELETE FROM slug_blocklist");
  });

  /** An invitation on a template with a known section set and theme boundary. */
  const withTemplate = async (
    options: {
      customizableThemeKeys?: readonly string[];
      status?: string;
      publishedAt?: Date;
    } = {},
  ): Promise<{ user: TestUser; invitationId: string }> => {
    const user = await createTestUser(harness.pool);
    const template = await createTestTemplateVersion(harness.pool, {
      sections: SECTIONS,
      theme: THEME,
      customizableThemeKeys: options.customizableThemeKeys ?? [
        "colors.primary",
      ],
    });
    const invitation = await createTestInvitation(harness.pool, {
      owner: user,
      template,
      ...(options.status !== undefined ? { status: options.status } : {}),
    });

    await harness.db
      .insert(
        (await import("../../src/infra/db/schema/invitations.js"))
          .invitationSettings,
      )
      .values({
        invitationId: invitation.id,
        enabledSections: ["hero", "gallery"],
      })
      .onConflictDoNothing();

    if (options.publishedAt !== undefined) {
      await harness.db
        .update(invitations)
        .set({ publishedAt: options.publishedAt })
        .where(eq(invitations.id, invitation.id));
    }

    return { user, invitationId: invitation.id };
  };

  describe("reading and writing the toggles", () => {
    it("returns slug alongside the toggles, as one domain object", async () => {
      // docs/PLAN/08 § Where Settings Fields Physically Live: two tables, one screen.
      const { user, invitationId } = await withTemplate();

      const settings = await service.get(user.scope, invitationId);

      expect(Object.keys(settings).sort()).toEqual([
        "enabled_sections",
        "guestbook_enabled",
        "guestbook_moderation",
        "rsvp_enabled",
        "seo_indexable",
        "slug",
        "theme_override",
      ]);
    });

    it("writes the toggles", async () => {
      const { user, invitationId } = await withTemplate();

      const result = await service.update(user.scope, invitationId, {
        rsvpEnabled: false,
        guestbookModeration: true,
        seoIndexable: true,
      });

      expect(result.rsvp_enabled).toBe(false);
      expect(result.guestbook_moderation).toBe(true);
      expect(result.seo_indexable).toBe(true);
    });

    it("is partial", async () => {
      const { user, invitationId } = await withTemplate();
      await service.update(user.scope, invitationId, { rsvpEnabled: false });

      await service.update(user.scope, invitationId, { seoIndexable: true });

      const result = await service.get(user.scope, invitationId);
      expect(result.rsvp_enabled).toBe(false);
      expect(result.seo_indexable).toBe(true);
    });

    it("writes to whichever table owns the column", async () => {
      // The slug lands on `invitations`; the toggles on `invitation_settings`. One call.
      const { user, invitationId } = await withTemplate();

      await service.update(user.scope, invitationId, {
        slug: "budi-dan-ani",
        rsvpEnabled: false,
      });

      const [invitation] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitationId));
      expect(invitation!.slug).toBe("budi-dan-ani");

      const settings = await repository.findOwnedSettings(
        invitationId,
        user.scope,
      );
      expect(settings!.rsvpEnabled).toBe(false);
    });
  });

  describe("enabled_sections is validated against the template (DoD 1 and 2)", () => {
    it("rejects a section_key the template does not define", async () => {
      const { user, invitationId } = await withTemplate();

      const error = await rejection(() =>
        service.update(user.scope, invitationId, {
          enabledSections: ["hero", "gallery", "countdown"],
        }),
      );

      expect(error.status).toBe(400);
      expect(JSON.stringify(error)).toContain("countdown");
    });

    it("stores nothing when a key is rejected", async () => {
      // The whole point: rejected, not stored-and-ignored.
      const { user, invitationId } = await withTemplate();

      await service
        .update(user.scope, invitationId, {
          enabledSections: ["hero", "nonsense"],
        })
        .catch(() => {});

      const settings = await repository.findOwnedSettings(
        invitationId,
        user.scope,
      );
      expect(settings!.enabledSections).toEqual(["hero", "gallery"]);
    });

    it("a non-configurable section cannot be disabled", async () => {
      // `hero` is `configurable: false`. A hero the user can switch off is a blank
      // invitation, and the template says so in data.
      const { user, invitationId } = await withTemplate();

      const error = await rejection(() =>
        service.update(user.scope, invitationId, {
          enabledSections: ["gallery"],
        }),
      );

      expect(error.status).toBe(422);
      expect(error.code).toBe("SECTION_NOT_CONFIGURABLE");
      expect(JSON.stringify(error)).toContain("hero");
    });

    it("a configurable section CAN be disabled", async () => {
      const { user, invitationId } = await withTemplate();

      const result = await service.update(user.scope, invitationId, {
        enabledSections: ["hero"],
      });
      expect(result.enabled_sections).toEqual(["hero"]);
    });

    it("rejects a duplicate key", async () => {
      // Not dangerous, not meaningful. Rejecting keeps the stored array a set, which is
      // what every reader assumes it is.
      const { user, invitationId } = await withTemplate();

      await expect(
        service.update(user.scope, invitationId, {
          enabledSections: ["hero", "gallery", "gallery"],
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("parseSections treats a missing `configurable` as NOT configurable", () => {
      // docs/PLAN/07 writes `configurable: true` explicitly for the toggleable kind, so
      // defaulting the other way would make every section in a template that omits the
      // flag switchable off.
      const parsed = parseSections([
        { section_key: "hero" },
        { section_key: "gallery", configurable: true },
        { section_key: "gift", configurable: false },
      ]);

      expect(parsed).toEqual([
        { key: "hero", configurable: false },
        { key: "gallery", configurable: true },
        { key: "gift", configurable: false },
      ]);
    });

    it("parseSections ignores malformed entries", () => {
      expect(parseSections([null, "hero", { configurable: true }, 42])).toEqual(
        [],
      );
      expect(parseSections("not an array")).toEqual([]);
    });
  });

  describe("theme_override is validated against customizable_theme_keys (DoD 3)", () => {
    it("accepts a permitted key", async () => {
      const { user, invitationId } = await withTemplate();

      const result = await service.update(user.scope, invitationId, {
        themeOverride: { colors: { primary: "#112233" } },
      });
      expect(result.theme_override).toEqual({
        colors: { primary: "#112233" },
      });
    });

    it("rejects a key outside the boundary", async () => {
      const { user, invitationId } = await withTemplate();

      const error = await rejection(() =>
        service.update(user.scope, invitationId, {
          themeOverride: { colors: { text: "#000000" } },
        }),
      );

      expect(error.status).toBe(400);
      expect(JSON.stringify(error)).toContain("colors.text");
    });

    it("a parent key does not grant a child", async () => {
      // `colors` permitted must not imply `colors.primary`, and vice versa. A prefix match
      // would quietly widen every template's boundary the first time somebody nested a
      // value.
      assertThemeKeysValid(["colors"], { colors: "#fff" });

      expect(() =>
        assertThemeKeysValid(["colors"], { colors: { primary: "#fff" } }),
      ).toThrow();
      expect(() =>
        assertThemeKeysValid(["colors.primary"], { colors: "#fff" }),
      ).toThrow();
    });

    it("stores nothing when a key is rejected", async () => {
      const { user, invitationId } = await withTemplate();

      await service
        .update(user.scope, invitationId, {
          themeOverride: { colors: { accent: "#ffffff" } },
        })
        .catch(() => {});

      const settings = await repository.findOwnedSettings(
        invitationId,
        user.scope,
      );
      expect(settings!.themeOverride).toEqual({});
    });

    describe("VALUES are validated too, because they become CSS custom properties", () => {
      it.each([
        ["a CSS injection", "red; background: url(https://evil.test/?c=1)"],
        ["a url()", "url(https://evil.test/x.png)"],
        ["a closing brace", "#fff}body{display:none"],
        ["an expression", "expression(alert(1))"],
        ["a semicolon", "#fff;"],
        ["a backslash escape", "\\0075rl(x)"],
        ["a var() reference", "var(--something-else)"],
        ["a space-separated pair", "#fff #000"],
      ])("rejects %s", async (_name, value) => {
        // An override comes from an END USER, unlike a template definition. Without this
        // check the value reaches a CSS custom property on a page every guest opens.
        const { user, invitationId } = await withTemplate();

        await expect(
          service.update(user.scope, invitationId, {
            themeOverride: { colors: { primary: value } },
          }),
        ).rejects.toMatchObject({ status: 400 });
      });

      it.each(["#fff", "#b76e79", "#B76E79", "rounded", "comfortable"])(
        "accepts %j",
        async (value) => {
          const { user, invitationId } = await withTemplate();

          await expect(
            service.update(user.scope, invitationId, {
              themeOverride: { colors: { primary: value } },
            }),
          ).resolves.toBeDefined();
        },
      );

      it("rejects a non-string value", async () => {
        const { user, invitationId } = await withTemplate();

        await expect(
          service.update(user.scope, invitationId, {
            themeOverride: { colors: { primary: 16711680 } },
          }),
        ).rejects.toMatchObject({ status: 400 });
      });

      it("a font key accepts a name with spaces", async () => {
        const { user, invitationId } = await withTemplate({
          customizableThemeKeys: ["typography.heading_font"],
        });

        await expect(
          service.update(user.scope, invitationId, {
            themeOverride: { typography: { heading_font: "Playfair Display" } },
          }),
        ).resolves.toBeDefined();
      });

      it("a font key still rejects a declaration", async () => {
        const { user, invitationId } = await withTemplate({
          customizableThemeKeys: ["typography.heading_font"],
        });

        await expect(
          service.update(user.scope, invitationId, {
            themeOverride: {
              typography: { heading_font: "Inter; background: red" },
            },
          }),
        ).rejects.toMatchObject({ status: 400 });
      });

      it("an array value is rejected rather than flattened into an index key", async () => {
        const { user, invitationId } = await withTemplate();

        await expect(
          service.update(user.scope, invitationId, {
            themeOverride: { colors: { primary: ["#fff"] } },
          }),
        ).rejects.toMatchObject({ status: 400 });
      });
    });
  });

  describe("the slug (BR-6.2, DoD 4 and 5)", () => {
    it("changes freely before the first publish", async () => {
      const { user, invitationId } = await withTemplate();

      const result = await service.update(user.scope, invitationId, {
        slug: "budi-dan-ani",
      });
      expect(result.slug).toBe("budi-dan-ani");
    });

    it("requires confirmation after publishing", async () => {
      // BR-6.2: "after publishing, changing the slug requires explicit confirmation
      // (since old links become invalid)".
      const { user, invitationId } = await withTemplate({
        status: "published",
        publishedAt: new Date(),
      });

      const error = await rejection(() =>
        service.update(user.scope, invitationId, { slug: "new-address" }),
      );

      expect(error.status).toBe(422);
      expect(error.code).toBe("SLUG_CHANGE_NEEDS_CONFIRMATION");
    });

    it("proceeds with confirmation", async () => {
      const { user, invitationId } = await withTemplate({
        status: "published",
        publishedAt: new Date(),
      });

      const result = await service.update(user.scope, invitationId, {
        slug: "new-address",
        confirmSlugChange: true,
      });
      expect(result.slug).toBe("new-address");
    });

    it("an UNPUBLISHED invitation that was once published still needs confirmation", async () => {
      // `published_at IS NULL`, not `status != 'published'`. Unpublishing does not
      // un-share the links people already hold, and the reason for the confirmation is
      // that those links break.
      const { user, invitationId } = await withTemplate({
        status: "paid",
        publishedAt: new Date(),
      });

      await expect(
        service.update(user.scope, invitationId, { slug: "new-address" }),
      ).rejects.toMatchObject({ code: "SLUG_CHANGE_NEEDS_CONFIRMATION" });
    });

    it("setting the same slug is a no-op needing no confirmation", async () => {
      const { user, invitationId } = await withTemplate({
        publishedAt: new Date(),
      });
      await harness.db
        .update(invitations)
        .set({ slug: "budi-dan-ani" })
        .where(eq(invitations.id, invitationId));

      await expect(
        service.update(user.scope, invitationId, { slug: "budi-dan-ani" }),
      ).resolves.toBeDefined();
    });

    it("a taken slug is 409", async () => {
      const first = await withTemplate();
      await service.update(first.user.scope, first.invitationId, {
        slug: "budi-dan-ani",
      });

      const second = await withTemplate();
      const error = await rejection(() =>
        service.update(second.user.scope, second.invitationId, {
          slug: "budi-dan-ani",
        }),
      );

      expect(error.status).toBe(409);
      expect(error.code).toBe("SLUG_TAKEN");
    });

    it("a concurrent claim is 409, not a 500 (DoD 5)", async () => {
      // docs/BACKEND/06 § Slug Validation. The availability check and the write are not
      // atomic, so two callers can both pass validation and one must lose the unique
      // index -- as a 409, because their request was reasonable and simply lost a race.
      const a = await withTemplate();
      const b = await withTemplate();

      const results = await Promise.allSettled([
        service.update(a.user.scope, a.invitationId, { slug: "same-address" }),
        service.update(b.user.scope, b.invitationId, { slug: "same-address" }),
      ]);

      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        status: 409,
      });
    });

    it("rejects a malformed slug", async () => {
      const { user, invitationId } = await withTemplate();

      await expect(
        service.update(user.scope, invitationId, { slug: "Budi Dan Ani" }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects a blocklisted slug", async () => {
      await harness.pool.query(
        "INSERT INTO slug_blocklist (term, match_type, category) VALUES ('admin', 'exact', 'reserved')",
      );
      const { user, invitationId } = await withTemplate();

      await expect(
        service.update(user.scope, invitationId, { slug: "admin" }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("IDOR", () => {
    it("another user cannot read or write settings", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);

      await expectServiceIdorSafe(() =>
        service.get(mallory.user.scope, alice.invitation.id),
      );
      await expectServiceIdorSafe(() =>
        service.update(mallory.user.scope, alice.invitation.id, {
          seoIndexable: true,
        }),
      );
    });

    it("another user cannot claim my slug through settings", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);

      await expectServiceIdorSafe(() =>
        service.update(mallory.user.scope, alice.invitation.id, {
          slug: "hijacked",
        }),
      );

      const [row] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, alice.invitation.id));
      expect(row!.slug).toBeNull();
    });

    it("each repository layer refuses a foreign scope", async () => {
      const { alice, mallory } = await createTwoTenants(harness.pool);

      expect(
        await repository.updateSettings(
          alice.invitation.id,
          mallory.user.scope,
          {
            seoIndexable: true,
          },
        ),
      ).toBeNull();

      expect(
        await repository.updateSlug(
          alice.invitation.id,
          mallory.user.scope,
          "hijacked",
        ),
      ).toBe(false);

      expect(
        await repository.findTemplateVersionFor(
          alice.invitation.id,
          mallory.user.scope,
        ),
      ).toBeNull();
    });

    it("a soft-deleted invitation refuses everything", async () => {
      const { user, invitationId } = await withTemplate();
      await harness.pool.query(
        "UPDATE invitations SET deleted_at = now() WHERE id = $1",
        [invitationId],
      );

      await expect(service.get(user.scope, invitationId)).rejects.toMatchObject(
        { status: 404 },
      );
      await expect(
        service.update(user.scope, invitationId, { seoIndexable: true }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("validation reads the invitation's OWN template version", () => {
    it("not the template's newest version", async () => {
      // BR-3.1: the invitation is locked to a version. Settings validation has to use that
      // one, or an admin publishing a template that drops a section would start rejecting
      // saves on invitations that legitimately still have it.
      const { user, invitationId } = await withTemplate();

      const [invitation] = await harness.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitationId));

      const newer = await createTestTemplateVersion(harness.pool, {
        templateId: invitation!.templateId,
        version: "2.0.0",
        sections: [
          {
            section_key: "hero",
            component: "HeroClassic",
            enabled_by_default: true,
            configurable: true,
            required_fields: [],
          },
        ],
        theme: THEME,
        customizableThemeKeys: ["colors.accent"],
      });
      await harness.db
        .update(templateVersions)
        .set({ status: "published" })
        .where(eq(templateVersions.id, newer.versionId));

      // `gallery` exists only on the LOCKED version, and must still be accepted.
      await expect(
        service.update(user.scope, invitationId, {
          enabledSections: ["hero", "gallery"],
        }),
      ).resolves.toBeDefined();

      // `colors.accent` is customizable only on the NEWER version, and must be refused.
      await expect(
        service.update(user.scope, invitationId, {
          themeOverride: { colors: { accent: "#ffffff" } },
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
