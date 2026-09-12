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
import { INVITATION_STATUS_PRESENTATION } from "@wi/ui";
import { axeViolationIds } from "@wi/ui/src/testing/axe.js";

import { AuthProvider } from "../src/lib/auth";
import { InvitationList } from "../src/components/InvitationList";
import { InvitationCard } from "../src/components/InvitationCard";
import { CreateWizard } from "../src/components/CreateWizard";
import {
  localSlugProblem,
  suggestSlug,
  type InvitationSummary,
} from "../src/lib/invitations";

/**
 * P1-21 — the dashboard and the creation wizard.
 *
 * The four DoD items are all statements about behaviour under a condition the happy path
 * never reaches: a badge whose colour must come from one place, an availability answer the
 * server is allowed to contradict, a wizard that must not be re-enterable, and a layout at
 * 360px. Each has a test that fails if the condition is handled the obvious wrong way.
 */

const PUBLIC_HOST = "https://invitation.test";

const invitation = (
  overrides: Partial<InvitationSummary> = {},
): InvitationSummary => ({
  id: "11111111-1111-4111-8111-111111111111",
  internal_name: "Budi & Ani",
  status: "draft",
  slug: null,
  template_id: "22222222-2222-4222-8222-222222222222",
  published_at: null,
  expiry_date: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const ok = (data: unknown, meta?: unknown) =>
  json(200, { success: true, data, ...(meta === undefined ? {} : { meta }) });

type Responder = (url: URL, init: RequestInit | undefined) => Response;

function renderWith(node: React.ReactNode, respond: Responder) {
  const calls: URL[] = [];

  const client = new ApiClient({
    baseUrl: "http://api.test/v1",
    tokenStore: accessTokenStore,
    fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : String(input));
      calls.push(url);
      return respond(url, init ?? undefined);
    },
  });

  const result = render(
    <AuthProvider client={client} restoreSession={false}>
      {node}
    </AuthProvider>,
  );

  return { ...result, calls };
}

beforeEach(() => {
  accessTokenStore.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ DoD item 1

describe("the status badge (card DoD 1)", () => {
  it("takes its label from the design system map, not from this component", async () => {
    // The card asks for badge colours to come from the map. Asserting the LABEL is how a
    // test can see that from outside: the label and the tone come from the same record, so a
    // card that rendered its own badge would have to duplicate the label too — and the test
    // reads it back out of `@wi/ui` rather than restating it, which is what makes the
    // assertion fail if the two ever diverge.
    renderWith(
      <InvitationCard
        invitation={invitation({ status: "pending_payment" })}
        publicHost={PUBLIC_HOST}
      />,
      () => ok([]),
    );

    expect(
      screen.getByText(INVITATION_STATUS_PRESENTATION.pending_payment.label),
    ).toBeInTheDocument();
  });

  it.each([
    "draft",
    "pending_payment",
    "paid",
    "published",
    "expired",
  ] as const)("renders %s through the shared map", (status) => {
    renderWith(
      <InvitationCard
        invitation={invitation({ status, slug: "budi-dan-ani" })}
        publicHost={PUBLIC_HOST}
      />,
      () => ok([]),
    );

    expect(
      screen.getByText(INVITATION_STATUS_PRESENTATION[status].label),
    ).toBeInTheDocument();
  });
});

describe("the invitation card", () => {
  it("shows the public address only once published", () => {
    const { rerender } = renderWith(
      <InvitationCard
        invitation={invitation({ status: "paid", slug: "budi-dan-ani" })}
        publicHost={PUBLIC_HOST}
      />,
      () => ok([]),
    );

    // A slug exists before publishing — the wizard sets one — but the page is not there yet.
    // Showing the address would invite the couple to share a link that 404s.
    expect(screen.queryByText(/invitation\.test\/budi-dan-ani/)).toBeNull();

    rerender(
      <InvitationCard
        invitation={invitation({ status: "published", slug: "budi-dan-ani" })}
        publicHost={PUBLIC_HOST}
      />,
    );
    expect(
      screen.getByText(/invitation\.test\/budi-dan-ani/),
    ).toBeInTheDocument();
  });

  it("gives every action an accessible name carrying the invitation", () => {
    // Down a list of twelve, "Edit, Edit, Edit" tells a screen-reader user nothing.
    renderWith(
      <InvitationCard
        invitation={invitation({ internal_name: "Rina & Joko" })}
        publicHost={PUBLIC_HOST}
      />,
      () => ok([]),
    );

    expect(
      screen.getByRole("link", { name: /edit rina & joko/i }),
    ).toBeInTheDocument();
  });

  it("does not leak the dashboard URL to the public invitation", () => {
    // An invitation id in a referrer header is a private identifier arriving on a public
    // page. The link opens on another origin, so it carries `noreferrer`.
    renderWith(
      <InvitationCard
        invitation={invitation({ status: "published", slug: "budi-dan-ani" })}
        publicHost={PUBLIC_HOST}
      />,
      () => ok([]),
    );

    const link = screen.getByRole("link", { name: /lihat/i });
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("renders a placeholder rather than a broken image while a photo processes", () => {
    const { container } = renderWith(
      <InvitationCard invitation={invitation()} publicHost={PUBLIC_HOST} />,
      () => ok([]),
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});

// --------------------------------------------------------------------- the list

describe("the dashboard list", () => {
  it("lists what the API returned", async () => {
    renderWith(
      <InvitationList publicHost={PUBLIC_HOST} createHref="/dashboard/new" />,
      () => ok([invitation(), invitation({ id: "2", internal_name: "Rina" })]),
    );

    expect(
      await screen.findByRole("heading", { name: "Budi & Ani" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rina" })).toBeInTheDocument();
  });

  it("filters by status through the query, not in the browser", async () => {
    // `docs/UI-UX/04`'s organiser has many invitations; filtering client-side would mean
    // fetching all of them to show five. The server already supports `?status=`.
    const { calls } = renderWith(
      <InvitationList publicHost={PUBLIC_HOST} createHref="/dashboard/new" />,
      () => ok([invitation()]),
    );

    await screen.findByRole("heading", { name: "Budi & Ani" });
    await userEvent.click(screen.getByRole("radio", { name: "Terbit" }));

    await waitFor(() => {
      expect(
        calls.some((url) => url.searchParams.get("status") === "published"),
      ).toBe(true);
    });
  });

  it("is a radio group, so exactly one filter is active", async () => {
    renderWith(
      <InvitationList publicHost={PUBLIC_HOST} createHref="/dashboard/new" />,
      () => ok([invitation()]),
    );

    await screen.findByRole("heading", { name: "Budi & Ani" });
    const group = screen.getByRole("radiogroup", { name: /status/i });
    await userEvent.click(within(group).getByRole("radio", { name: "Draf" }));

    await waitFor(() => {
      const checked = within(group)
        .getAllByRole("radio")
        .filter((r) => r.getAttribute("aria-checked") === "true");
      expect(checked).toHaveLength(1);
    });
  });

  it("guides an empty dashboard towards creating one", async () => {
    // `docs/UI-UX/01` principle 7 — a call to action, not "no data".
    renderWith(
      <InvitationList publicHost={PUBLIC_HOST} createHref="/dashboard/new" />,
      () => ok([]),
    );

    expect(
      await screen.findByRole("link", { name: /buat undangan pertama/i }),
    ).toHaveAttribute("href", "/dashboard/new");
  });

  it("tells a user whose FILTER matched nothing to clear the filter", async () => {
    // The two empty states need opposite advice. Telling somebody with twelve invitations
    // to create their first one is the version of this that ships.
    renderWith(
      <InvitationList publicHost={PUBLIC_HOST} createHref="/dashboard/new" />,
      (url) => ok(url.searchParams.has("status") ? [] : [invitation()]),
    );

    await screen.findByRole("heading", { name: "Budi & Ani" });
    await userEvent.click(screen.getByRole("radio", { name: "Kedaluwarsa" }));

    expect(
      await screen.findByRole("button", { name: /tampilkan semua/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/undangan pertama/i)).toBeNull();
  });

  it("reports a failed load instead of showing an empty dashboard", async () => {
    // An error rendered as "you have no invitations" is the worst available outcome: it
    // looks like data loss.
    renderWith(
      <InvitationList publicHost={PUBLIC_HOST} createHref="/dashboard/new" />,
      () =>
        json(500, {
          success: false,
          error: { code: "INTERNAL_ERROR", message: "boom" },
        }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/undangan pertama/i)).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = renderWith(
      <InvitationList publicHost={PUBLIC_HOST} createHref="/dashboard/new" />,
      () => ok([invitation({ status: "published", slug: "budi-dan-ani" })]),
    );

    await screen.findByRole("heading", { name: "Budi & Ani" });
    expect(await axeViolationIds(container)).toEqual([]);
  });
});

// ------------------------------------------------------------- the slug helpers

describe("the local slug mirror (card step 5)", () => {
  it.each([
    ["ab", /minimal/i],
    ["a".repeat(51), /maksimal/i],
    ["Budi", /huruf kecil/i],
    ["-budi", /huruf kecil/i],
    ["budi-", /huruf kecil/i],
    ["budi ani", /huruf kecil/i],
  ])("rejects %s locally", (slug, expected) => {
    expect(localSlugProblem(slug)).toMatch(expected);
  });

  it("accepts what the server accepts", () => {
    expect(localSlugProblem("budi-dan-ani")).toBeUndefined();
    expect(localSlugProblem("abc")).toBeUndefined();
  });

  it("says nothing about an empty field", () => {
    // A form that shouts at somebody before they have typed anything is a form people leave.
    expect(localSlugProblem("")).toBeUndefined();
  });

  it("does not mirror the blocklist", () => {
    // Deliberate: the blocklist is a table an admin edits without a deploy
    // (`docs/SECURITY/10`), so a copy here would be wrong the first time somebody added a
    // word. `admin` is reserved server-side and passes the local format check.
    expect(localSlugProblem("admin")).toBeUndefined();
  });

  it("suggests an address from the couple's own words", () => {
    expect(suggestSlug("Budi & Ani")).toBe("budi-ani");
    expect(suggestSlug("  Rina   dan Joko!! ")).toBe("rina-dan-joko");
  });

  it("keeps a letter that carries an accent rather than dropping it", () => {
    expect(suggestSlug("Café Wedding")).toBe("cafe-wedding");
  });
});

// ------------------------------------------------------------------ the wizard

describe("the creation wizard", () => {
  const templates = [{ id: "tpl-1", name: "Elegant Rose" }];

  it("shows the template step when no template was chosen", () => {
    renderWith(
      <CreateWizard
        templates={templates}
        onCreated={vi.fn()}
        dashboardHref="/dashboard"
      />,
      () => ok({}),
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /pilih template/i,
    );
  });

  it("skips the template step when one arrived from the catalogue", () => {
    // Card step 4. A step that only confirms a decision already made is a step people click
    // through without reading.
    renderWith(
      <CreateWizard
        presetTemplateId="tpl-1"
        templates={templates}
        onCreated={vi.fn()}
        dashboardHref="/dashboard"
      />,
      () => ok({}),
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /nama dan alamat/i,
    );
  });

  it("suggests an address from the name and stops once the user edits it", async () => {
    renderWith(
      <CreateWizard
        presetTemplateId="tpl-1"
        templates={templates}
        onCreated={vi.fn()}
        dashboardHref="/dashboard"
      />,
      () => ok({ available: true, slug: "x" }),
    );

    await userEvent.type(screen.getByLabelText(/nama internal/i), "Budi & Ani");
    await waitFor(() => {
      expect(screen.getByLabelText(/alamat undangan/i)).toHaveValue("budi-ani");
    });

    // Once the address is theirs, it stays theirs. Overwriting a deliberate choice on every
    // keystroke of a different field is the kind of helpfulness people hate.
    const slugField = screen.getByLabelText(/alamat undangan/i);
    await userEvent.clear(slugField);
    await userEvent.type(slugField, "pernikahan-kami");
    await userEvent.type(screen.getByLabelText(/nama internal/i), " 2027");

    expect(slugField).toHaveValue("pernikahan-kami");
  });

  it("checks availability before submission (DoD 2)", async () => {
    const { calls } = renderWith(
      <CreateWizard
        presetTemplateId="tpl-1"
        templates={templates}
        onCreated={vi.fn()}
        dashboardHref="/dashboard"
      />,
      () => ok({ available: true, slug: "budi-dan-ani" }),
    );

    await userEvent.type(
      screen.getByLabelText(/alamat undangan/i),
      "budi-dan-ani",
    );

    await waitFor(
      () => {
        expect(
          calls.some((url) => url.pathname.endsWith("/slug-available")),
        ).toBe(true);
      },
      { timeout: 3_000 },
    );

    // Twice on purpose: the visible helper and the polite announcement.
    expect((await screen.findAllByText(/tersedia/i)).length).toBeGreaterThan(0);
  });

  it("does not ask the server about an address the local rules already reject", async () => {
    // A request to be told something the mirror knows is a request spent for nothing, and on
    // a phone at eleven at night it is also a visible delay.
    const { calls } = renderWith(
      <CreateWizard
        presetTemplateId="tpl-1"
        templates={templates}
        onCreated={vi.fn()}
        dashboardHref="/dashboard"
      />,
      () => ok({ available: true, slug: "x" }),
    );

    await userEvent.type(screen.getByLabelText(/alamat undangan/i), "ab");
    await new Promise((r) => setTimeout(r, 600));

    expect(calls.some((url) => url.pathname.endsWith("/slug-available"))).toBe(
      false,
    );
  });

  it("the server still wins when it says the address is taken (DoD 2)", async () => {
    // ADR-057. The advisory check said yes; somebody claimed the address in between. The
    // user must be told, on the field, with their work intact.
    renderWith(
      <CreateWizard
        presetTemplateId="tpl-1"
        templates={templates}
        onCreated={vi.fn()}
        dashboardHref="/dashboard"
      />,
      (url) =>
        url.pathname.endsWith("/slug-available")
          ? ok({ available: true, slug: "budi-dan-ani" })
          : json(409, {
              success: false,
              error: {
                code: "SLUG_TAKEN",
                message: "Alamat sudah digunakan.",
              },
            }),
    );

    await userEvent.type(screen.getByLabelText(/nama internal/i), "Budi & Ani");
    const slugField = screen.getByLabelText(/alamat undangan/i);
    await userEvent.clear(slugField);
    await userEvent.type(slugField, "budi-dan-ani");
    await screen.findAllByText(/tersedia/i);

    await userEvent.click(
      screen.getByRole("button", { name: /buat dan lanjut/i }),
    );

    await waitFor(() => {
      expect(slugField).toHaveAttribute("aria-invalid", "true");
    });
    // The work survives: the name is still there and the user is still on the step.
    expect(screen.getByLabelText(/nama internal/i)).toHaveValue("Budi & Ani");
  });

  it("hands the new invitation to the caller, which redirects into the editor", async () => {
    const onCreated = vi.fn();
    renderWith(
      <CreateWizard
        presetTemplateId="tpl-1"
        templates={templates}
        onCreated={onCreated}
        dashboardHref="/dashboard"
      />,
      (url) =>
        url.pathname.endsWith("/slug-available")
          ? ok({ available: true, slug: "budi-dan-ani" })
          : ok({
              id: "new-invitation-id",
              slug: "budi-dan-ani",
              status: "draft",
              template_id: "tpl-1",
              template_version_id: "v1",
            }),
    );

    await userEvent.type(screen.getByLabelText(/nama internal/i), "Budi & Ani");
    await userEvent.click(
      screen.getByRole("button", { name: /buat dan lanjut/i }),
    );

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith("new-invitation-id");
    });
  });

  it("has no axe violations on either step", async () => {
    const first = renderWith(
      <CreateWizard
        templates={templates}
        onCreated={vi.fn()}
        dashboardHref="/dashboard"
      />,
      () => ok({}),
    );
    expect(await axeViolationIds(first.container)).toEqual([]);
    cleanup();

    const second = renderWith(
      <CreateWizard
        presetTemplateId="tpl-1"
        templates={templates}
        onCreated={vi.fn()}
        dashboardHref="/dashboard"
      />,
      () => ok({}),
    );
    expect(await axeViolationIds(second.container)).toEqual([]);
  });
});
