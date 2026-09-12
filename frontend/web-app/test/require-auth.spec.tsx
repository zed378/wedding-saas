import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ApiClient, accessTokenStore } from "@wi/api-client";

import { AuthProvider } from "../src/lib/auth";
import { RequireAuth } from "../src/components/RequireAuth";

/**
 * P1-20 step 3 and DoD item 2 — the route guard, and where it sends people.
 *
 * The two behaviours that matter are both about **not** doing something:
 *
 *   it does not redirect while the session is still being restored, because the access token
 *     lives in memory and a reload always starts without one;
 *   it does not drop the query string, because the template a user picked is in it.
 */

const replace = vi.fn();
let pathname = "/dashboard";
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

/** A client whose `/auth/me` answers however the test wants. */
function clientAnswering(me: () => Response | Promise<Response>) {
  return new ApiClient({
    baseUrl: "http://api.test/v1",
    tokenStore: accessTokenStore,
    fetch: async () => me(),
  });
}

const signedIn = () =>
  new Response(
    JSON.stringify({
      success: true,
      data: {
        id: "u1",
        email: "budi@example.test",
        full_name: "Budi",
        role: "user",
        email_verified: true,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const signedOut = () =>
  new Response(
    JSON.stringify({
      success: false,
      error: { code: "UNAUTHENTICATED", message: "no" },
    }),
    { status: 401, headers: { "content-type": "application/json" } },
  );

beforeEach(() => {
  replace.mockClear();
  accessTokenStore.clear();
  pathname = "/dashboard";
  search = "";
});

afterEach(cleanup);

describe("RequireAuth", () => {
  it("renders the page for a signed-in user", async () => {
    render(
      <AuthProvider client={clientAnswering(signedIn)}>
        <RequireAuth>
          <p>rahasia</p>
        </RequireAuth>
      </AuthProvider>,
    );

    expect(await screen.findByText("rahasia")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not redirect while the session is being restored", () => {
    // The access token is in memory only, so a page reload always starts with none and one
    // refresh in flight. A guard that treated that as "not signed in" would bounce every
    // reload of every protected page to the login screen and back — the flicker that makes
    // an application feel broken.
    render(
      <AuthProvider
        client={clientAnswering(
          () => new Promise<Response>(() => undefined), // never settles
        )}
      >
        <RequireAuth fallback={<p>memuat</p>}>
          <p>rahasia</p>
        </RequireAuth>
      </AuthProvider>,
    );

    expect(screen.getByText("memuat")).toBeInTheDocument();
    expect(screen.queryByText("rahasia")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends an anonymous visitor to login with the intended path", async () => {
    render(
      <AuthProvider client={clientAnswering(signedOut)}>
        <RequireAuth>
          <p>rahasia</p>
        </RequireAuth>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/login?next=%2Fdashboard");
    });
    expect(screen.queryByText("rahasia")).not.toBeInTheDocument();
  });

  it("carries the query string, so a chosen template survives (DoD 3)", async () => {
    // `docs/UI-UX/11` § "Use This Template". The template is a query parameter, and a guard
    // that kept only the path would land the user on `/dashboard/new` with nothing selected —
    // one step short of what they came to do, which is the exact complaint the requirement
    // exists to prevent.
    pathname = "/dashboard/new";
    search = "template=elegant-rose";

    render(
      <AuthProvider client={clientAnswering(signedOut)}>
        <RequireAuth>
          <p>rahasia</p>
        </RequireAuth>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        "/login?next=%2Fdashboard%2Fnew%3Ftemplate%3Delegant-rose",
      );
    });
  });

  it("never renders the children for an anonymous visitor, even for one frame", async () => {
    // A flash of private chrome is a real leak: a screenshot, a shoulder, a slow redirect.
    const { container } = render(
      <AuthProvider client={clientAnswering(signedOut)}>
        <RequireAuth>
          <p>rahasia</p>
        </RequireAuth>
      </AuthProvider>,
    );

    expect(container.textContent).not.toContain("rahasia");
    await waitFor(() => {
      expect(replace).toHaveBeenCalled();
    });
    expect(container.textContent).not.toContain("rahasia");
  });
});
