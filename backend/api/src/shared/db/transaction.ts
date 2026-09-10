import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";

import type * as schema from "../../infra/db/schema/index";

/**
 * A Drizzle transaction handle.
 *
 * Named here rather than repeated inline because several services take one as a
 * parameter, and that parameter is load-bearing: a method that requires a `Transaction`
 * cannot be called outside one. `AuditLogService.record` and the status writer both use
 * that to make "atomic with the change it describes" a type error to get wrong rather
 * than a rule to remember.
 */
export type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
