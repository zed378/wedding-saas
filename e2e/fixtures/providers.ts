import type { Page, Route } from "@playwright/test";

/**
 * Provider mocks at the HTTP boundary. `P0-19` step 5.
 *
 * Intercepting the network rather than stubbing a module is the point. A module stub
 * proves the code calls the function we told it to call; an HTTP intercept proves the
 * request that would have left the process is the one we expected, with the headers and
 * body it would really have carried.
 *
 * It also means a test can never accidentally reach the real provider. `docs/DEVOPS/00`
 * puts staging on sandbox credentials and `P0-18` refuses live keys outside production
 * -- but a sandbox charge is still a charge someone has to reconcile, and an email sent
 * from a test run goes to a real inbox.
 */

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

/**
 * Block every outbound provider call, and record what would have been sent.
 *
 * The default for any request that is NOT explicitly handled is to ABORT, not to pass
 * through. A test that quietly reaches a real provider because nobody wrote a route for
 * it is the failure this exists to prevent.
 */
export async function mockProviders(page: Page): Promise<{
  midtrans: RecordedRequest[];
  email: RecordedRequest[];
}> {
  const midtrans: RecordedRequest[] = [];
  const email: RecordedRequest[] = [];

  const record = (into: RecordedRequest[]) => (route: Route) => {
    const request = route.request();
    into.push({
      url: request.url(),
      method: request.method(),
      body: safeJson(request.postData()),
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mocked: true }),
    });
  };

  await page.route("**://*.midtrans.com/**", record(midtrans));
  await page.route("**://*.sandbox.midtrans.com/**", record(midtrans));
  await page.route("**://api.resend.com/**", record(email));

  // The catch-all. Anything to a third party that is not one of the above is refused
  // outright rather than allowed through -- a test must not depend on the internet, and
  // must not be able to touch a provider nobody thought to mock.
  await page.route("**", async (route) => {
    const url = new URL(route.request().url());
    const isLocal = ["localhost", "127.0.0.1", "0.0.0.0"].includes(
      url.hostname,
    );
    if (isLocal) return route.continue();

    return route.abort("blockedbyclient");
  });

  return { midtrans, email };
}

function safeJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
