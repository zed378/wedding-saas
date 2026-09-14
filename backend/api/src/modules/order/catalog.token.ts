export type { CatalogReader } from "./catalog.repository";

/** Injection token for the catalogue reads, so services can be tested against a fixture. */
export const CATALOG = Symbol("CATALOG");
