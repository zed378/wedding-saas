import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient, accessTokenStore } from "@wi/api-client";
// jsdom has no `showModal`; `@wi/ui`'s setup documents exactly what this polyfill does and
// does not prove (focus trapping and inertness are the workbench E2E's job).
import "@wi/ui/src/testing/setup.js";

import { AuthProvider } from "../src/lib/auth";
import { EditorProvider } from "../src/editor/EditorProvider";
import { SharePreview } from "../src/editor/SharePreview";

/**
 * `P2-12` — the editor's share-preview dialog.
 *
 * What this pins is the part a couple can get wrong without noticing: the link is shown once
 * and cannot be recovered, the list never shows a token, and revoking reaches the API.
 */

interface Call {
  readonly method: string;
  readonly path: string;
}

function renderWithApi(respond: (call: Call) => Response) {
  const calls: Call[] = [];

  const client = new ApiClient({
    baseUrl: "http://api.test/api/v1",
    tokenStore: accessTokenStore,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const call = {
        method: init?.method ?? "GET",
        path: url.pathname.replace("/api/v1", ""),
      };
      calls.push(call);
      return respond(call);
    },
  });

  render(
    <AuthProvider client={client} restoreSession={false}>
      <EditorProvider
        invitationId="inv-1"
        data={{}}
        transport={{ save: async () => undefined }}
        debounceMs={10}
      >
        <SharePreview />
      </EditorProvider>
    </AuthProvider>,
  );

  return calls;
}

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  });

const TOKEN = "Pv7kQ2mX9aLw4rT8nB3cY6dF1gH5jK0zE_s-uVoI2pA";

beforeEach(() => {
  accessTokenStore.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("creating a link", () => {
  it("shows the new link once, with a warning that it will not be shown again", async () => {
    const links: unknown[] = [];
    renderWithApi((call) => {
      if (call.method === "POST") {
        const created = {
          id: "link-1",
          token: TOKEN,
          url: `https://invitation.test/preview/${TOKEN}`,
          expires_at: "2026-09-20T00:00:00.000Z",
          created_at: "2026-09-13T00:00:00.000Z",
        };
        links.push({
          id: "link-1",
          expires_at: created.expires_at,
          created_at: created.created_at,
          last_accessed_at: null,
        });
        return ok(created, 201);
      }
      return ok(links);
    });

    await userEvent.click(
      screen.getByRole("button", { name: /bagikan pratinjau/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /buat tautan baru/i }),
    );

    const field = await screen.findByLabelText("Tautan pratinjau");
    expect(field).toHaveValue(`https://invitation.test/preview/${TOKEN}`);
    expect(screen.getByText(/hanya ditampilkan sekali/i)).toBeInTheDocument();
  });

  it("does not show the link again after the dialog is closed and reopened", async () => {
    // The token is not stored anywhere readable, so the list cannot recover it — and the
    // dialog must not pretend otherwise by keeping a stale copy in memory.
    renderWithApi((call) =>
      call.method === "POST"
        ? ok(
            {
              id: "link-1",
              token: TOKEN,
              url: `https://invitation.test/preview/${TOKEN}`,
              expires_at: "2026-09-20T00:00:00.000Z",
              created_at: "2026-09-13T00:00:00.000Z",
            },
            201,
          )
        : ok([
            {
              id: "link-1",
              expires_at: "2026-09-20T00:00:00.000Z",
              created_at: "2026-09-13T00:00:00.000Z",
              last_accessed_at: null,
            },
          ]),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /bagikan pratinjau/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /buat tautan baru/i }),
    );
    await screen.findByLabelText("Tautan pratinjau");

    // The close control rather than Escape: the polyfill cannot fire `cancel`.
    await userEvent.click(screen.getByRole("button", { name: "Tutup" }));
    await userEvent.click(
      screen.getByRole("button", { name: /bagikan pratinjau/i }),
    );

    await screen.findByRole("button", { name: /buat tautan baru/i });
    expect(screen.queryByLabelText("Tautan pratinjau")).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN);
  });
});

describe("the active list", () => {
  it("shows when each link expires and whether it was opened, never a token", async () => {
    renderWithApi(() =>
      ok([
        {
          id: "link-1",
          expires_at: "2026-09-20T00:00:00.000Z",
          created_at: "2026-09-13T00:00:00.000Z",
          last_accessed_at: null,
        },
        {
          id: "link-2",
          expires_at: "2026-09-19T00:00:00.000Z",
          created_at: "2026-09-12T00:00:00.000Z",
          last_accessed_at: "2026-09-12T10:00:00.000Z",
        },
      ]),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /bagikan pratinjau/i }),
    );

    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Belum pernah dibuka")).toBeInTheDocument();
    expect(within(list).getByText(/terakhir dibuka/i)).toBeInTheDocument();
  });

  it("revokes through the API and says the link no longer opens", async () => {
    let revoked = false;
    const calls = renderWithApi((call) => {
      if (call.method === "DELETE") {
        revoked = true;
        return ok({ status: "revoked" });
      }
      return ok(
        revoked
          ? []
          : [
              {
                id: "link-1",
                expires_at: "2026-09-20T00:00:00.000Z",
                created_at: "2026-09-13T00:00:00.000Z",
                last_accessed_at: null,
              },
            ],
      );
    });

    await userEvent.click(
      screen.getByRole("button", { name: /bagikan pratinjau/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /cabut/i }),
    );

    await waitFor(() => {
      expect(calls).toContainEqual({
        method: "DELETE",
        path: "/invitations/inv-1/preview-links/link-1",
      });
    });
    expect(await screen.findByText(/dicabut/i)).toBeInTheDocument();
    expect(
      await screen.findByText("Belum ada tautan aktif."),
    ).toBeInTheDocument();
  });
});
