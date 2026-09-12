// Minimum valid environment for tests. Kept in one place so a new required variable
// breaks every test at once with a clear message, rather than one test obscurely.
process.env["NODE_ENV"] = "test";
// A real port, not 0: the schema rejects 0 because a service bound to an ephemeral port
// in production is unreachable. The testing module never listens, so the value is unused.
process.env["PORT"] = "3000";
process.env["APP_ORIGIN"] = "https://app.vizunicum.my.id";
process.env["PUBLIC_INVITE_ORIGIN"] = "https://invitation.vizunicum.my.id";
process.env["ADMIN_ORIGIN"] = "https://admin.vizunicum.my.id";
process.env["DATABASE_URL"] =
  "postgres://wedding_app:pw@localhost:5432/wedding";
// Required since P1-02 added the queue producer. Nothing in the unit suite connects to
// it; the value exists so `loadEnv` succeeds.
process.env["REDIS_URL"] = "redis://localhost:6379";
// Required since P1-03. 32 characters minimum in every environment -- a short HMAC key is
// brute-forceable offline wherever it runs, so the schema does not make an exception for
// tests either. These are not secrets: nothing signed with them leaves the test process.
process.env["JWT_SIGNING_KEY"] =
  "test-signing-key-not-used-outside-vitest-0000";
process.env["REFRESH_TOKEN_PEPPER"] =
  "test-pepper-not-used-outside-vitest-000000000";
