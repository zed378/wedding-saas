import { Injectable, type NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * First middleware in the chain. Every log line and every job payload carries this id,
 * which is what makes a single upload traceable from the HTTP request through to worker
 * completion (docs/DEVOPS/05 § Distributed Tracing, docs/DEVOPS/06 § Request Correlation).
 *
 * An inbound id is accepted only from a trusted proxy; otherwise a client could pick its
 * own and collide with, or forge, another request's trail. Until the proxy is configured
 * (P0-23) every id is generated here.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const id = randomUUID();
    (req as Request & { requestId: string }).requestId = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  }
}
