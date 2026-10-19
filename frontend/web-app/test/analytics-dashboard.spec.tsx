import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient, accessTokenStore } from "@wi/api-client";

import { AuthProvider } from "../src/lib/auth";
import { InvitationCard } from "../src/components/InvitationCard";
import AnalyticsDashboardPage from "../src/app/(app)/dashboard/[invitationId]/analytics/page";
import type { InvitationAnalytics, InvitationSummary } from "../src/lib/invitations";

const testInvitation: InvitationSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  internal_name: "Maya & Dimas",
  status: "published",
  slug: "maya-dimas",
  template_id: "22222222-2222-4222-8222-222222222222",
  published_at: "2026-10-15T00:00:00.000Z",
  expiry_date: "2027-10-15",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-15T00:00:00.000Z",
};

const mockAnalytics: InvitationAnalytics = {
  views: {
    total: 142,
    daily: [
      { date: "2026-10-19", count: 42 },
      { date: "2026-10-18", count: 100 },
    ],
  },
  rsvps: {
    total_responses: 25,
    attending: 20,
    not_attending: 3,
    maybe: 2,
    total_attending_guests: 38,
  },
  guestbook: {
    total: 15,
    pending: 2,
    approved: 12,
    rejected: 1,
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("InvitationCard - Analytics Link (P4-10)", () => {
  it("renders accessible link to the analytics dashboard", () => {
    render(
      <InvitationCard
        invitation={testInvitation}
        publicHost="https://invitation.test"
      />,
    );

    const link = screen.getByRole("link", { name: "Statistik Maya & Dimas" });
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe(
      `/dashboard/${testInvitation.id}/analytics`,
    );
  });
});

describe("AnalyticsDashboardPage (P4-10)", () => {
  let client: ApiClient;

  beforeEach(() => {
    accessTokenStore.set("test-token");
    client = new ApiClient({ baseUrl: "https://api.test" });
  });

  afterEach(() => {
    cleanup();
    accessTokenStore.clear();
    vi.restoreAllMocks();
  });

  it("renders page opens with honest labeling, rsvps, and guestbook metrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes(`/invitations/${testInvitation.id}/analytics`)) {
          return Promise.resolve(json(200, { success: true, data: mockAnalytics }));
        }
        return Promise.resolve(json(404, { success: false }));
      }),
    );

    render(
      <AuthProvider initialClient={client}>
        <AnalyticsDashboardPage
          params={{ invitationId: testInvitation.id }}
        />
      </AuthProvider>,
    );

    // Initial heading
    expect(screen.getByRole("heading", { name: "Statistik Undangan" })).toBeDefined();

    // Wait for data load
    await waitFor(() => {
      expect(screen.getByText("142")).toBeDefined();
    });

    // Check honest labeling per DoD
    expect(
      screen.getByText(/bukan jumlah orang atau tamu unik/i),
    ).toBeDefined();

    // Check daily views
    expect(screen.getByText("2026-10-19")).toBeDefined();
    expect(screen.getByText("42")).toBeDefined();
    expect(screen.getByText("2026-10-18")).toBeDefined();
    expect(screen.getByText("100")).toBeDefined();

    // Check RSVPs
    expect(screen.getByText("25 respon diterima")).toBeDefined();
    expect(screen.getByText("38")).toBeDefined(); // total attending guests
    expect(screen.getByText("20")).toBeDefined(); // attending

    // Check Guestbook
    expect(screen.getByText("15 pesan masuk")).toBeDefined();
    expect(screen.getByText("12")).toBeDefined(); // approved
    expect(screen.getAllByText("2").length).toBe(2); // maybe RSVP and pending guestbook
  });

  it("surfaces error alert and retry button when analytics fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          json(500, {
            success: false,
            error: { code: "INTERNAL_ERROR", message: "Server error" },
          }),
        ),
      ),
    );

    render(
      <AuthProvider initialClient={client}>
        <AnalyticsDashboardPage
          params={{ invitationId: testInvitation.id }}
        />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByText("Gagal memuat statistik")).toBeDefined();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeDefined();
  });
});
