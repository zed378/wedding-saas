import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient, accessTokenStore } from "@wi/api-client";
import "@wi/ui/src/testing/setup.js";

import { AuthProvider } from "../src/lib/auth";
import { EditorProvider } from "../src/editor/EditorProvider";
import { PublishCta } from "../src/editor/PublishCta";
import { UnpublishAction } from "../src/editor/UnpublishAction";
import { EditorShell } from "../src/editor/EditorShell";
import type { TemplateDefinition } from "../src/editor/store";

const DEFINITION: TemplateDefinition = {
  sections: [
    {
      section_key: "couple",
      configurable: false,
      enabled_by_default: true,
      required_fields: ["couple.groom.nickname", "couple.bride.nickname"],
    },
    {
      section_key: "event",
      configurable: false,
      enabled_by_default: true,
      required_fields: ["events.*.title"],
    },
  ],
  enabledSections: ["couple", "event"],
};

const COMPLETE_DATA = {
  settings: { slug: "budi-dan-siti" },
  couple: {
    groom: { nickname: "Budi" },
    bride: { nickname: "Siti" },
  },
  events: [{ title: "Akad Nikah" }],
};

function createMockClient(
  handler: (path: string, options?: RequestInit) => Response | Promise<Response>,
) {
  return new ApiClient({
    baseUrl: "http://api.test/v1",
    tokenStore: accessTokenStore,
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const path = url.replace("http://api.test/v1", "");
      return handler(path, init);
    },
  });
}

describe("P3-15 — Publish and Unpublish Flow", () => {
  beforeEach(() => {
    accessTokenStore.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("DoD 1: Missing-field errors are navigable — clicking one lands on the field", () => {
    it("opens missing-fields modal when server reports incomplete data and navigates to section", async () => {
      const user = userEvent.setup();
      let activeSection = "couple";

      const client = createMockClient((path) => {
        if (path === "/invitations/inv-1/publish-check") {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                ready: false,
                missing_fields: [
                  {
                    section_key: "event",
                    path: "events.0.title",
                    label: "Judul acara di bagian Acara",
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      render(
        <AuthProvider client={client} restoreSession={false}>
          <EditorProvider
            invitationId="inv-1"
            data={COMPLETE_DATA}
            templateDefinition={DEFINITION}
            transport={{ save: async () => undefined }}
            debounceMs={10}
          >
            <PublishCta />
            {/* Dummy target field */}
            <input name="events.0.title" data-field="events.0.title" />
          </EditorProvider>
        </AuthProvider>,
      );

      const publishBtn = screen.getByRole("button", { name: "Terbitkan" });
      await user.click(publishBtn);

      // Missing fields modal appears
      expect(
        await screen.findByText("Lengkapi isian berikut sebelum menerbitkan"),
      ).toBeVisible();
      const missingFieldBtn = screen.getByRole("button", {
        name: "Judul acara di bagian Acara",
      });
      expect(missingFieldBtn).toBeVisible();

      // Click missing field
      await user.click(missingFieldBtn);

      // Modal closes
      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", {
            name: "Lengkapi isian berikut sebelum menerbitkan",
          }),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("Step 2: When the invitation is complete but unpaid, route to checkout", () => {
    it("shows payment required modal with checkout link when publish requires payment", async () => {
      const user = userEvent.setup();

      const client = createMockClient((path, init) => {
        if (path === "/invitations/inv-1/publish-check") {
          return new Response(
            JSON.stringify({
              success: true,
              data: { ready: true, missing_fields: [] },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (path === "/invitations/inv-1/publish" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              success: false,
              error: {
                code: "PAYMENT_REQUIRED",
                message: "Lakukan pembayaran untuk menerbitkan undangan ini.",
              },
            }),
            { status: 402, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      render(
        <AuthProvider client={client} restoreSession={false}>
          <EditorProvider
            invitationId="inv-1"
            data={COMPLETE_DATA}
            templateDefinition={DEFINITION}
            transport={{ save: async () => undefined }}
            debounceMs={10}
          >
            <PublishCta />
          </EditorProvider>
        </AuthProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Terbitkan" }));

      // Slug confirmation modal opens
      expect(
        await screen.findByText("Konfirmasi alamat undangan"),
      ).toBeVisible();
      expect(
        screen.getByText("invitation.vizunicum.my.id/budi-dan-siti"),
      ).toBeVisible();

      // Click confirm "Terbitkan"
      const confirmBtn = screen.getAllByRole("button", { name: "Terbitkan" })[1];
      await user.click(confirmBtn!);

      // Payment required modal appears
      expect(
        await screen.findByText("Pembayaran diperlukan"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Aktivasi Rp 139\.000 untuk 12 bulan akses penuh/),
      ).toBeInTheDocument();

      // Has "Bayar Sekarang" link to /checkout/inv-1
      const checkoutLink = screen.getByRole("link", { name: "Bayar Sekarang" });
      expect(checkoutLink).toHaveAttribute("href", "/checkout/inv-1");
    });
  });

  describe("DoD 2: The publish result screen shows the working public link", () => {
    it("renders working public link, copy action, and WhatsApp share on publish success", async () => {
      const user = userEvent.setup();
      const PUBLIC_URL = "https://invitation.vizunicum.my.id/budi-dan-siti";

      const client = createMockClient((path, init) => {
        if (path === "/invitations/inv-1/publish-check") {
          return new Response(
            JSON.stringify({
              success: true,
              data: { ready: true, missing_fields: [] },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (path === "/invitations/inv-1/publish" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                status: "published",
                slug: "budi-dan-siti",
                published_at: "2026-10-17T12:00:00Z",
                expiry_date: "2027-10-17",
                public_url: PUBLIC_URL,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      render(
        <AuthProvider client={client} restoreSession={false}>
          <EditorProvider
            invitationId="inv-1"
            data={COMPLETE_DATA}
            templateDefinition={DEFINITION}
            transport={{ save: async () => undefined }}
            debounceMs={10}
          >
            <PublishCta />
          </EditorProvider>
        </AuthProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Terbitkan" }));

      // Confirm in slug modal
      const confirmBtn = (await screen.findAllByRole("button", { name: "Terbitkan" }))[1];
      await user.click(confirmBtn!);

      // Publish success modal is displayed
      expect(
        await screen.findByText("Undangan berhasil diterbitkan!"),
      ).toBeVisible();

      // Public URL input
      const input = screen.getByDisplayValue(PUBLIC_URL);
      expect(input).toBeInTheDocument();

      // "Buka tautan" link
      const openLink = screen.getByRole("link", { name: /buka tautan/i });
      expect(openLink).toHaveAttribute("href", PUBLIC_URL);
      expect(openLink).toHaveAttribute("target", "_blank");

      // WhatsApp share link
      const waLink = screen.getByRole("link", { name: /whatsapp/i });
      expect(waLink).toHaveAttribute("href", expect.stringContaining("wa.me"));
      expect(waLink).toHaveAttribute(
        "href",
        expect.stringContaining(encodeURIComponent(PUBLIC_URL)),
      );
    });
  });

  describe("DoD 3: A slug conflict is recoverable without leaving the flow", () => {
    it("handles 409 SLUG_TAKEN inline, allows editing or accepting suggestion, and publishes", async () => {
      const user = userEvent.setup();
      let patchSettingsCalled = false;
      let finalSlugUsed = "";

      const client = createMockClient((path, init) => {
        if (path === "/invitations/inv-1/publish-check") {
          return new Response(
            JSON.stringify({
              success: true,
              data: { ready: true, missing_fields: [] },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (path === "/invitations/inv-1/publish" && init?.method === "POST") {
          if (!patchSettingsCalled) {
            // First attempt: slug is taken
            return new Response(
              JSON.stringify({
                success: false,
                error: {
                  code: "SLUG_TAKEN",
                  message: "Alamat undangan sudah digunakan.",
                  details: [{ message: "budi-dan-siti-1" }],
                },
              }),
              { status: 409, headers: { "content-type": "application/json" } },
            );
          }
          // Second attempt: succeeds
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                status: "published",
                slug: finalSlugUsed,
                published_at: "2026-10-17T12:00:00Z",
                expiry_date: "2027-10-17",
                public_url: `https://invitation.vizunicum.my.id/${finalSlugUsed}`,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (path === "/invitations/inv-1/settings" && init?.method === "PATCH") {
          patchSettingsCalled = true;
          const body = JSON.parse(init.body as string);
          finalSlugUsed = body.slug;
          return new Response(
            JSON.stringify({
              success: true,
              data: { slug: body.slug },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      render(
        <AuthProvider client={client} restoreSession={false}>
          <EditorProvider
            invitationId="inv-1"
            data={COMPLETE_DATA}
            templateDefinition={DEFINITION}
            transport={{ save: async () => undefined }}
            debounceMs={10}
          >
            <PublishCta />
          </EditorProvider>
        </AuthProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Terbitkan" }));

      // Confirm in slug modal
      const confirmBtn = (await screen.findAllByRole("button", { name: "Terbitkan" }))[1];
      await user.click(confirmBtn!);

      // Shows slug conflict state inline
      expect(
        await screen.findByText(/sudah digunakan\. Pilih alamat lain\./),
      ).toBeVisible();

      // Shows suggestion button
      const suggestionBtn = screen.getByRole("button", {
        name: "budi-dan-siti-1",
      });
      expect(suggestionBtn).toBeVisible();

      // Click suggestion
      await user.click(suggestionBtn);

      const input = screen.getByLabelText("Alamat undangan");
      expect(input).toHaveValue("budi-dan-siti-1");

      // Click "Gunakan Alamat Ini"
      const retryBtn = screen.getByRole("button", { name: "Gunakan Alamat Ini" });
      await user.click(retryBtn);

      // Now successfully published without leaving the modal flow
      expect(
        await screen.findByText("Undangan berhasil diterbitkan!"),
      ).toBeVisible();
      expect(
        screen.getByDisplayValue(
          "https://invitation.vizunicum.my.id/budi-dan-siti-1",
        ),
      ).toBeInTheDocument();
      expect(patchSettingsCalled).toBe(true);
    });
  });

  describe("DoD 4: Unpublish explains what happens before it happens", () => {
    it("renders unpublish button when published and shows plain explanation before action", async () => {
      const user = userEvent.setup();
      let unpublishCalled = false;
      const onUnpublishedMock = vi.fn();

      const client = createMockClient((path, init) => {
        if (path === "/invitations/inv-1/unpublish" && init?.method === "POST") {
          unpublishCalled = true;
          return new Response(
            JSON.stringify({
              success: true,
              data: { status: "paid" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      render(
        <AuthProvider client={client} restoreSession={false}>
          <EditorProvider
            invitationId="inv-1"
            data={COMPLETE_DATA}
            templateDefinition={DEFINITION}
            transport={{ save: async () => undefined }}
            debounceMs={10}
          >
            <UnpublishAction onUnpublished={onUnpublishedMock} />
          </EditorProvider>
        </AuthProvider>,
      );

      const unpublishBtn = screen.getByRole("button", {
        name: "Batalkan publikasi",
      });
      expect(unpublishBtn).toBeVisible();

      await user.click(unpublishBtn);

      // Confirmation modal is visible with plain consequence explanation
      expect(
        await screen.findByText("Batalkan publikasi undangan?"),
      ).toBeVisible();
      expect(
        screen.getByText(
          "Tautan publik akan berhenti bekerja. Tamu yang sudah punya link tidak akan bisa mengaksesnya.",
        ),
      ).toBeVisible();

      // Click confirm "Batalkan Publikasi"
      const confirmUnpublishBtn = screen.getByRole("button", {
        name: "Batalkan Publikasi",
      });
      await user.click(confirmUnpublishBtn);

      await waitFor(() => {
        expect(unpublishCalled).toBe(true);
        expect(onUnpublishedMock).toHaveBeenCalledTimes(1);
      });
    });

    it("cancelling unpublish leaves state untouched without calling API", async () => {
      const user = userEvent.setup();
      let unpublishCalled = false;

      const client = createMockClient((path, init) => {
        if (path === "/invitations/inv-1/unpublish" && init?.method === "POST") {
          unpublishCalled = true;
        }
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      render(
        <AuthProvider client={client} restoreSession={false}>
          <EditorProvider
            invitationId="inv-1"
            data={COMPLETE_DATA}
            templateDefinition={DEFINITION}
            transport={{ save: async () => undefined }}
            debounceMs={10}
          >
            <UnpublishAction onUnpublished={vi.fn()} />
          </EditorProvider>
        </AuthProvider>,
      );

      await user.click(
        screen.getByRole("button", { name: "Batalkan publikasi" }),
      );

      const cancelBtn = await screen.findByRole("button", { name: "Batal" });
      await user.click(cancelBtn);

      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: "Batalkan publikasi undangan?" }),
        ).not.toBeInTheDocument();
      });
      expect(unpublishCalled).toBe(false);
    });
  });
});
