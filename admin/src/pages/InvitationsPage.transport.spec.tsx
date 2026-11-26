import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { accessTokenStore } from "@wi/api-client";
import { InvitationsPage } from "./InvitationsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  accessTokenStore.clear();
});

it("sends authenticated list and detail requests through the real API client", async () => {
  accessTokenStore.set("admin-access-token");
  const row = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    slug: "budi-ratna",
    status: "draft",
    owner_name: "Budi",
    owner_email: "budi@example.test",
    template_name: "Klasik",
    version: "1.0.0",
    expiry_date: null,
  };
  const fetch = vi.fn().mockImplementation(
    async (url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          success: true,
          data: url.includes(row.id)
            ? {
                ...row,
                owner: { email: row.owner_email, full_name: row.owner_name },
                template_version: {
                  id: "version",
                  name: "Klasik",
                  version: "1.0.0",
                },
                published_at: null,
                validation_summary: {
                  ready: true,
                  missing_required_fields: 0,
                  incomplete_sections: [],
                },
                order_history: [],
                status_history: [],
              }
            : [row],
          meta: { total: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  render(<InvitationsPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Lihat detail budi-ratna" }),
  );
  expect(
    await screen.findByText("Konten wajib sudah lengkap."),
  ).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
  const listUrl = new URL(fetch.mock.calls[0]![0]);
  expect(listUrl.origin).toBe("http://localhost:3000");
  expect(listUrl.pathname).toBe("/api/v1/admin/invitations");
  expect(listUrl.searchParams.get("limit")).toBe("20");
  expect(fetch.mock.calls[1]![0]).toBe(
    `http://localhost:3000/api/v1/admin/invitations/${row.id}`,
  );
  for (const [, init] of fetch.mock.calls) {
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer admin-access-token",
    );
  }
});
