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
