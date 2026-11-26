import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { ApiClient } from "@wi/api-client";
import {
  assertValidTemplateVersion,
  type TemplateVersionDefinition,
} from "@wi/schema";
import { render, screen, fireEvent } from "@testing-library/react";
import { TemplatesPage } from "./TemplatesPage.js";
import { ThemeEditor } from "../components/templates/ThemeEditor.js";
import { SectionEditor } from "../components/templates/SectionEditor.js";
import { TemplatePreview } from "../components/templates/TemplatePreview.js";
import {
  calculateContrastRatio,
  evaluateWcagContrast,
} from "../components/templates/contrast.js";
import { DUMMY_INVITATION_DATA } from "../components/templates/dummy-data.js";
import type { SectionDefinition, Theme } from "@wi/schema";

describe("Admin Template Editor UI & Dummy Preview (P5-05)", () => {
  const sampleTheme: Theme = {
    colors: {
      primary: "#8B5E3C",
      secondary: "#FFFFFF",
      accent: "#C9A876",
      text: "#111111", // High contrast against #ffffff
    },
    typography: {
      heading_font: "Playfair Display",
      body_font: "Inter",
      scale: "default",
    },
    spacing: "comfortable",
    border_radius: "rounded",
  };

  const sampleSections: SectionDefinition[] = [
    {
      section_key: "hero",
      component: "HeroClassic",
      enabled_by_default: true,
      configurable: false,
      required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
      optional_fields: [],
    },
    {
      section_key: "couple",
      component: "CoupleClassic",
      enabled_by_default: true,
      configurable: true,
      required_fields: ["couple.groom.name", "couple.bride.name"],
      optional_fields: [],
    },
  ];

  describe("WCAG AA Contrast Checker (docs/UI-UX/17)", () => {
    it("calculates correct contrast ratio for black on white", () => {
      const ratio = calculateContrastRatio("#000000", "#ffffff");
      expect(ratio).toBeGreaterThanOrEqual(20);
    });

    it("evaluates failing contrast ratio (< 4.5:1) for low-contrast pair", () => {
      // Light gray on white
      const result = evaluateWcagContrast("#aaaaaa", "#ffffff");
      expect(result.passesNormalText).toBe(false);
      expect(result.warningMessage).toContain(
        "Peringatan Aksesibilitas WCAG AA",
      );
      expect(result.ratio).toBeLessThan(4.5);
    });

    it("renders contrast warning banner in ThemeEditor when contrast is below 4.5:1", () => {
      const failingTheme: Theme = {
        ...sampleTheme,
        colors: {
          ...sampleTheme.colors,
          text: "#888888", // Low contrast on #ffffff (~3.5:1)
          secondary: "#ffffff",
        },
      };

      render(
        <ThemeEditor
          theme={failingTheme}
          customizableThemeKeys={["colors.primary"]}
          onChangeTheme={() => {}}
          onChangeCustomizableKeys={() => {}}
        />,
      );

      const warning = screen.getByTestId("contrast-warning");
      expect(warning).toBeDefined();
      expect(warning.textContent).toContain("Peringatan Aksesibilitas WCAG AA");
    });

    it("does not render contrast warning banner when contrast is >= 4.5:1", () => {
      render(
        <ThemeEditor
          theme={sampleTheme}
          customizableThemeKeys={["colors.primary"]}
          onChangeTheme={() => {}}
          onChangeCustomizableKeys={() => {}}
        />,
      );

      expect(screen.queryByTestId("contrast-warning")).toBeNull();
    });
  });

  describe("SectionEditor (Components & Canonical Field Paths)", () => {
    it("selects components from dropdown and field paths from registered list, never typed", () => {
      render(<SectionEditor sections={sampleSections} onChange={() => {}} />);

      // Section titles and component dropdowns
      expect(screen.getByText(/Struktur & Bagian Undangan/i)).toBeDefined();

      // Check section selection dropdown
      const selectSectionToAdd = screen.getByLabelText(
        /Pilih jenis bagian untuk ditambahkan/i,
      ) as HTMLSelectElement;
      expect(selectSectionToAdd).toBeDefined();
      // Should have section keys from SECTION_KEYS
      expect(selectSectionToAdd.options.length).toBeGreaterThan(3);

      // Canonical field checkboxes must be present
      expect(
        screen.getAllByText(/Wajib Diisi \(Required Fields\)/i).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(/Opsional \(Optional Fields\)/i).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(/Pemetaan Field Kanonikal/i).length,
      ).toBeGreaterThan(0);
    });
  });

  describe("TemplatePreview (Production Renderer with Dummy Data in Demo Mode)", () => {
    it("renders preview with dummy invitation data and supports mobile/desktop toggle", () => {
      render(
        <TemplatePreview
          sections={sampleSections}
          theme={sampleTheme}
          data={DUMMY_INVITATION_DATA}
        />,
      );

      // Default is mobile viewport (375px frame)
      expect(screen.getByTestId("preview-mobile-frame")).toBeDefined();

      // Mode demo should render dummy couple names (Budi & Siti)
      expect(screen.getAllByText(/Budi/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Siti/i).length).toBeGreaterThan(0);

      // Switch to desktop
      const desktopBtn = screen.getByRole("button", {
        name: /Tampilan Desktop/i,
      });
      fireEvent.click(desktopBtn);

      expect(screen.getByTestId("preview-desktop-frame")).toBeDefined();
    });
  });

  describe("TemplatesPage Full Flow", () => {
    beforeEach(() => {
      vi.spyOn(ApiClient.prototype, "get").mockResolvedValue({
        data: [
          {
            id: "template-id",
            slug: "javanese-classic",
            name: "Javanese Classic Elegance",
            category: ["traditional"],
            isPremium: false,
            status: "published",
            createdAt: "2026-11-26T00:00:00Z",
            updatedAt: "2026-11-26T00:00:00Z",
            versions: [
              {
                id: "version-id",
                templateId: "template-id",
                version: "1.0.0",
                sections: sampleSections,
                theme: sampleTheme,
                customizableThemeKeys: [],
                status: "published",
                createdAt: "2026-11-26T00:00:00Z",
                invitation_count: 12,
              },
            ],
          },
        ],
        meta: undefined,
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it("submits a new draft version that passes the production template validator", async () => {
      vi.spyOn(ApiClient.prototype, "get").mockResolvedValue({
        data: [],
        meta: undefined,
      });
      const post = vi
        .spyOn(ApiClient.prototype, "post")
        .mockImplementation(async (path, body) => {
          if (path === "/api/v1/admin/templates")
            return {
              data: {
                id: "new-template",
                name: "Penerimaan",
                slug: "penerimaan",
                category: [],
                isPremium: false,
                status: "draft",
                versions: [],
              },
              meta: undefined,
            };
          const {
            reason: _reason,
            version: _version,
            changelog: _changelog,
            ...definition
          } = body as Record<string, unknown>;
          assertValidTemplateVersion(
            definition as unknown as TemplateVersionDefinition,
          );
          return {
            data: { ...(body as object), id: "new-version", status: "draft" },
            meta: undefined,
          };
        });
      render(<TemplatesPage />);
      await screen.findByRole("heading", { name: /Katalog Templat/i });
      fireEvent.click(
        screen.getByRole("button", { name: /Tambah Templat Baru/ }),
      );
      fireEvent.change(screen.getByLabelText(/Nama Templat/), {
        target: { value: "Penerimaan" },
      });
      fireEvent.change(screen.getByLabelText(/^Slug/), {
        target: { value: "penerimaan" },
      });
      fireEvent.change(screen.getByLabelText(/Alasan Pembuatan \(Audit/), {
        target: { value: "Alasan penerimaan" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Buat Templat" }));
      await screen.findByRole("heading", { name: "Penerimaan" });
      fireEvent.click(screen.getByRole("button", { name: /Rilis Versi Baru/ }));
      fireEvent.change(screen.getByLabelText(/Alasan Pembuatan Versi/), {
        target: { value: "Alasan penerimaan" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Buat Versi Draf" }));
      await screen.findByRole("button", { name: /Publikasikan Versi/ });
      expect(post).toHaveBeenCalledTimes(2);
    });

    it("renders catalog, navigates to template editor, and displays affected invitation count before deprecating", async () => {
      render(<TemplatesPage />);

      // Catalog view
      expect(
        await screen.findByRole("heading", { name: /Katalog Templat/i }),
      ).toBeDefined();
      expect(screen.getByText(/Javanese Classic Elegance/i)).toBeDefined();

      // Click "Kelola Templat"
      const manageButtons = screen.getAllByRole("button", {
        name: /Kelola Templat/i,
      });
      fireEvent.click(manageButtons[0]!);

      // Detail view loaded
      expect(
        screen.getByRole("heading", { name: /Javanese Classic Elegance/i }),
      ).toBeDefined();

      // Verify affected count is shown for the version
      const affectedBadge = screen.getByTestId("version-affected-count");
      expect(affectedBadge.textContent).toContain("12 Undangan");

      // Published version shows Deprecate button
      const deprecateBtn = screen.getByRole("button", {
        name: /Depresiasi Versi/i,
      });
      fireEvent.click(deprecateBtn);

      // Modal opens and explicitly shows the affected count first!
      const notice = screen.getByTestId("deprecate-affected-notice");
      expect(notice.textContent).toContain("12 undangan aktif");
    });

    it("allows switching between Sections, Theme, Assets, and Preview tabs", async () => {
      render(<TemplatesPage />);
      await screen.findByRole("heading", { name: /Katalog Templat/i });

      const manageButtons = screen.getAllByRole("button", {
        name: /Kelola Templat/i,
      });
      fireEvent.click(manageButtons[0]!);

      // Click Theme tab
      const themeTab = screen.getByRole("button", { name: /Tema & Kontras/i });
      fireEvent.click(themeTab);
      expect(screen.getByText(/Palet Warna Tema/i)).toBeDefined();

      // Click Assets tab
      const assetsTab = screen.getByRole("button", { name: /Aset Media/i });
      fireEvent.click(assetsTab);
      expect(screen.getByText(/Aset Grafis & Media Templat/i)).toBeDefined();

      // Click Preview tab
      const previewTab = screen.getByRole("button", {
        name: /Pratinjau Nyata/i,
      });
      fireEvent.click(previewTab);
      expect(screen.getByTestId("preview-mobile-frame")).toBeDefined();
    });
  });
});
