import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { DB, type Database } from "../../infra/db/client";
import { users } from "../../infra/db/schema/users";
import { UnauthenticatedError } from "../../http/errors";
import {
  InvalidAccessTokenError,
  verifyAccessToken,
} from "./tokens/access-token.service";

/**
 * P1-03 — "who is this request from", and the answer the rest of the application uses.
 *
 * ## The token says who. The database says what they may do.
 *
 * `docs/SECURITY/01` § Elevation of Privilege: a role that changed, or an account that was
 * suspended, must take effect before the access token expires. A fifteen-minute window in
 * which a suspended user keeps working is fifteen minutes of an incident still running.
 *
 * So this reads the user row on every authenticated request and returns **its** `role`,
 * `status` and `email_verified` -- never the token's copies. The token is used for one
 * thing: proving the bearer knows a `sub` we signed.
 *
 * That is one indexed primary-key lookup per request. `P1-06` wraps this in the middleware
 * and may add a short cache; if it does, the cache has to be invalidated by the admin
 * suspend path (`P6-04`), and the DoD item below is the test that would catch forgetting.
 */

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: string;
  readonly emailVerified: boolean;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Resolve a bearer token to a user, or throw.
   *
   * One error for every reason. A caller that could tell "expired" from "forged" from
   * "suspended" would be an oracle, and the client behaviour is the same in all three:
   * refresh, and if that fails, log in.
   */
  async authenticate(bearer: string | undefined): Promise<AuthenticatedUser> {
    const token = extractBearer(bearer);
    if (token === undefined) throw new UnauthenticatedError();

    let claims;
    try {
      claims = await verifyAccessToken(this.env.JWT_SIGNING_KEY, token);
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        throw new UnauthenticatedError();
      }
      throw error;
    }

    const user = await this.loadActiveUser(claims.userId);
    if (user === undefined) throw new UnauthenticatedError();

    return user;
  }

  /**
   * The row, if the account is usable. `undefined` for a missing, soft-deleted or
   * suspended one.
   *
   * The status filter is in the `WHERE` clause rather than an `if` after the read, for the
   * same reason ownership is (`docs/SECURITY/05`): a condition in the query cannot be
   * skipped by a later code path that forgot it existed.
   */
  async loadActiveUser(userId: string): Promise<AuthenticatedUser | undefined> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);

    return rows[0];
  }
}

/**
 * `Authorization: Bearer <token>` -> `<token>`.
 *
 * Case-insensitive on the scheme because RFC 7235 says the scheme is, and rejecting
 * `bearer` in lowercase would be a bug that only shows up with one HTTP client.
 */
export function extractBearer(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}
