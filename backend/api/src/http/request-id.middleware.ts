import { Injectable, type NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { runWithRequestContext } from "../shared/logging/request-context";
import { logger } from "../shared/logging/logger";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * First middleware in the chain. Every log line and every job payload carries this id,
 * which is what makes a single upload traceable from the HTTP request through to worker
 * completion (docs/DEVOPS/05 § Distributed Tracing, docs/DEVOPS/06 § Request Correlation).
 *
 * An inbound id is accepted only from a trusted proxy; otherwise a client could pick its
 * own and collide with, or forge, another request's trail. Until the proxy is configured
 * (P0-23) every id is generated here.
 *
 * The id is established as an AsyncLocalStorage context rather than only hung off `req`,
 * so a log written inside a repository three layers down still carries it. Threading a
 * logger through every constructor works until one function forgets -- and the line with
 * no id is invariably the one you need during an incident.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const id = randomUUID();
    (req as Request & { requestId: string }).requestId = id;
    res.setHeader(REQUEST_ID_HEADER, id);

    runWithRequestContext({ requestId: id }, () => {
      const startedAt = process.hrtime.bigint();

      // Logged on 'finish' rather than up front, so one line carries both the request
      // and its outcome. Two half-lines per request is twice the volume and worse to
      // read. `finish` fires even when the client disconnects mid-response.
      res.on("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        logger.info(
          {
            context: {
              method: req.method,
              // req.originalUrl, not req.url: Express rewrites req.url inside routers,
              // so the logged path would otherwise be relative to the mount point.
              // The query string is dropped -- it is untrusted input and can carry a
              // token someone pasted into a link.
              path: req.originalUrl.split("?")[0],
              status: res.statusCode,
              duration_ms: Math.round(durationMs * 100) / 100,
            },
          },
          "request completed",
        );
      });

      next();
    });
  }
}
