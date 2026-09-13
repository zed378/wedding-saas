import "server-only";

import type { SlugStrategy } from "./slug";

/**
 * `P2-08` — the two things this application needs to know about where it is running.
 *
 * Read at call time rather than at module load. A value captured when the module is first
 * imported is a value baked into the build, and this app is built once and run in
 * staging and production — `docs/DEVOPS/00` § Environments is explicit that configuration
 * is per-environment and the artefact is not.
 *
 * Neither is `NEXT_PUBLIC_`, deliberately. `API_INTERNAL_BASE_URL` is a container name on
 * the deployed stack and would not resolve from a browser; sending it to one would also
 * publish the shape of the internal network for nothing.
 */

export interface PublicInviteConfig {
  /** Where the API lives from inside the network, e.g. `http://api:3000`. */
  readonly apiBaseUrl: string;
  /** How an address turns into a slug. `docs/BACKEND/06`. */
  readonly slugStrategy: SlugStrategy;
  /** The canonical origin, for `og:url` and the canonical link. */
  readonly publicOrigin: string;
}

export function readConfig(): PublicInviteConfig {
  return {
    // A default rather than a throw, and only this one: the value that makes `pnpm dev`
    // work against a local API. A missing API address in production shows up on the first
    // request as a connection error naming the host, which is a clearer failure than a
    // page that renders "not found" for every invitation.
    apiBaseUrl: process.env["API_INTERNAL_BASE_URL"] ?? "http://localhost:3000",
    slugStrategy:
      process.env["SLUG_STRATEGY"] === "subdomain" ? "subdomain" : "path",
    publicOrigin: (
      process.env["PUBLIC_INVITE_ORIGIN"] ?? "http://localhost:3200"
    ).replace(/\/+$/, ""),
  };
}
