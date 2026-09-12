# Backend tests

Two suites, two commands, one rule about the database.

```bash
pnpm --filter @wi/api test              # unit — no database, no network
pnpm --filter @wi/api test:integration  # integration — a real PostgreSQL
```

## The database the integration suite needs

Two generations of suite live side by side, and they get their database differently.

| Suite                                                                                          | How it connects                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `harness.ts` based (`registration`, `auth-session`, `google-oauth`, `password-reset`, `authz`) | Prefers `TEST_DATABASE_URL` / `MIGRATION_DATABASE_URL`; otherwise starts a Testcontainer. Applies migrations itself |
| `helpers.ts` based — the `*-schema` suites and `audit-status`, `tenancy`                       | Connects to `MIGRATION_DATABASE_URL` and **fails** if it is unreachable                                             |

Neither ever skips. `P0-19` step 7 is explicit about why: a skipped integration suite
reports green for constraints nobody verified, and the board then says a task passed when
its tests did not run.

So the whole suite needs a real database:

```bash
POSTGRES_PORT=55432 docker compose -f deploy/docker-compose.yml up -d postgres
export MIGRATION_DATABASE_URL="postgres://wedding_owner:wedding_owner_dev@localhost:55432/wedding"
export DATABASE_URL="postgres://wedding_app:wedding_app_dev@localhost:55432/wedding"
pnpm --filter @wi/api db:migrate
pnpm --filter @wi/api test:integration
```

`POSTGRES_PORT` is worth knowing about: 5432 and 6379 are frequently already taken on a
developer machine, and the failure looks like a Docker networking error rather than a port
clash.

## The IDOR helper — `test/support/idor.ts`

`docs/SECURITY/04` § Mandatory Testing makes _"User B cannot access User A's resource"_ a
definition-of-done item for **every** `:id` endpoint, and
`scripts/check-id-endpoint-tests.mjs` fails the build for a new `:id` route without one.
A mandatory test that is tedious to write is a mandatory test somebody eventually writes
badly, so this helper exists to make the honest version one line.

### The whole standard case

```ts
import { expectIdorSafe } from "../support/idor";

it("another user cannot read this invitation", async () => {
  await expectIdorSafe(harness.pool, (id, scope) =>
    service.getInvitation(id, scope),
  );
});
```

That builds two tenants, asserts Mallory cannot reach Alice's invitation, **and asserts
Alice still can**. The second half is not politeness: a service that returned `null` to
everybody would pass every IDOR test ever written and ship a broken product.

### The two halves separately

```ts
// The service, called directly — no HTTP anywhere.
// This is the layer docs/SECURITY/04 § Implementation Principle 2 is about: a job or
// another module calling the service must not reach another tenant's row either.
await expectServiceIdorSafe(
  () => service.get(alice.invitation.id, mallory.user.scope),
  { mustNotContain: ["Alice's wedding"] },
);

// The endpoint, over supertest. 404 AND an empty body.
await expectHttpIdorSafe(
  () =>
    request(app.getHttpServer())
      .get(`/api/v1/invitations/${alice.invitation.id}`)
      .set("Authorization", `Bearer ${malloryToken}`),
  { mustNotContain: ["Alice's wedding"] },
);
```

### What it refuses to accept

| The service does                          | The helper                        | Why                                                                                                                        |
| ----------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Returns the row                           | **fails**                         | The leak itself                                                                                                            |
| Returns `null`                            | passes                            | Correct                                                                                                                    |
| Throws `404`                              | passes                            | Correct                                                                                                                    |
| Throws **`403`**                          | **fails**                         | `docs/SECURITY/04` § Note — 403 confirms the resource exists, which is the enumeration oracle the 404 rule exists to close |
| Returns `null` to everyone                | **fails**                         | Passes every IDOR test and breaks the product                                                                              |
| Answers 404 with the resource in the body | **fails** (with `mustNotContain`) | A leak with a misleading status code                                                                                       |

Each of those rows has a test in `test/integration/authz.itest.ts` under
_"the IDOR helper itself"_ — including three whose passing depends on an assertion
failing. A helper that cannot fail proves nothing, and every later endpoint's mandatory
test inherits whatever this one is worth.

## Other shared fixtures

| File                             | What it gives you                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `support/harness.ts`             | A migrated database and a Drizzle client. `startHarness({ redis: true })` for Redis                                                                     |
| `support/factories.ts`           | `createTestUser`, `createTestInvitation`, `createTwoTenants`                                                                                            |
| `support/rejection.ts`           | `rejection(fn)` — a call that must reject, narrowed. `.catch((e) => e as X)` types as `Result \| X` and also passes when the call unexpectedly resolves |
| `support/envelope-assertions.ts` | `expectSuccess`, `expectError`, `expectNoInternalLeak`                                                                                                  |
| `integration/helpers.ts`         | `connect()`, `resetTenantData()`, `tag()`                                                                                                               |

## Conventions worth knowing

**`user_tokens` is shared between features.** Registration leaves an
`email_verification` row and a reset leaves a `password_reset` row in the same table. An
unfiltered `select().from(userTokens)` is almost always a bug — it cost `P1-05` a test
that asserted a 24-hour lifetime against a one-hour rule.

**Mutate before believing a security test.** After writing one, break the control it
names and confirm _that_ test fails. Four times in this project a test has verified less
than its name suggested, and every time only the mutation found it.
