import { ValidationError } from "./errors";
import type { PageMeta } from "./envelope";

/**
 * Pagination, identical on every list endpoint. `docs/API/00` § Pagination:
 * `page`, `per_page`, default 20, max 100.
 *
 * One helper rather than a convention, because "default 20, max 100" repeated across a
 * dozen handlers is a rule that holds on eleven of them. The twelfth accepts
 * `per_page=100000` and becomes a cheap way to pull the whole table.
 */

export const DEFAULT_PER_PAGE = 20;
export const MAX_PER_PAGE = 100;

export interface Pagination {
  readonly page: number;
  readonly perPage: number;
  /** For SQL. Derived here so no handler computes it and gets it off by one page. */
  readonly offset: number;
  readonly limit: number;
}

/**
 * Parse `page` and `per_page` from a query object.
 *
 * Rejects rather than clamps. Silently turning `per_page=1000` into 100 means a client
 * paginating through results gets a different page size than it asked for and quietly
 * skips records -- the bug surfaces as missing data much later, in someone else's code.
 * A 400 is immediate and says what to fix.
 */
export function parsePagination(query: Record<string, unknown>): Pagination {
  const page = parsePositiveInt(query["page"], "page", 1);
  const perPage = parsePositiveInt(
    query["per_page"],
    "per_page",
    DEFAULT_PER_PAGE,
  );

  if (perPage > MAX_PER_PAGE) {
    throw new ValidationError([
      { field: "per_page", message: `Must be ${MAX_PER_PAGE} or fewer.` },
    ]);
  }

  return { page, perPage, offset: (page - 1) * perPage, limit: perPage };
}

/**
 * Plain decimal digits only.
 *
 * `Number("1e3")` is 1000 and `Number("0x10")` is 16 -- both are integers ≥ 1, so a
 * `Number.isInteger` check accepts them. Neither is wrong here, because there is only
 * one parser in the path, but accepting several spellings of the same value is the
 * shape of a whole class of validation bypass: one layer reads `1e3` as a thousand and
 * another reads it as one. Requiring `/^\d+$/` removes the question rather than
 * answering it, and costs nothing -- no real client sends a page number in scientific
 * notation.
 */
function parsePositiveInt(
  raw: unknown,
  field: string,
  fallback: number,
): number {
  if (raw === undefined || raw === "") return fallback;

  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 1) throw badNumber(field);
    return raw;
  }

  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw badNumber(field);

  const value = Number(raw);
  // A query string can carry more digits than a Number can hold exactly.
  if (!Number.isSafeInteger(value) || value < 1) throw badNumber(field);

  return value;
}

function badNumber(field: string): ValidationError {
  return new ValidationError([
    { field, message: "Must be a positive whole number." },
  ]);
}

/** The `meta` block for a paginated response. */
export function pageMeta(pagination: Pagination, total: number): PageMeta {
  return { page: pagination.page, per_page: pagination.perPage, total };
}
