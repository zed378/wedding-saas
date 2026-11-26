import { createServer, request as httpRequest, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

/** Serve the production admin bundle with the same-origin API routing used by Caddy. */
export async function startAdminServer(): Promise<() => Promise<void>> {
  const root = resolve(__dirname, "../../admin/dist");
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };
  const server: Server = createServer(async (req, res) => {
    if (req.url?.startsWith("/api/")) {
      const upstream = httpRequest(
        {
          hostname: "localhost",
          port: 3000,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: "localhost:3000" },
        },
        (reply) => {
          res.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
      return;
    }
    const path = resolve(
      root,
      `.${new URL(req.url ?? "/", "http://localhost").pathname}`,
    );
    if (
      !path.startsWith(`${root}\\`) &&
      !path.startsWith(`${root}/`) &&
      path !== root
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const file = extname(path) ? path : resolve(root, "index.html");
      res.writeHead(200, {
        "content-type": types[extname(file)] ?? "application/octet-stream",
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(3300, resolveReady);
  });
  return () =>
    new Promise<void>((resolveClosed, reject) =>
      server.close((error) => (error ? reject(error) : resolveClosed())),
    );
}
