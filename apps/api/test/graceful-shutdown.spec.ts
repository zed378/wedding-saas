import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { gracefulShutdown } from "../src/http/graceful-shutdown";

/**
 * Shutdown is tested against a real HTTP server rather than by sending SIGTERM to a
 * child process, deliberately: Windows does not deliver POSIX signals, so a signal-based
 * test would pass on CI and prove nothing on a developer machine. What the DoD actually
 * claims -- an in-flight request finishes, new connections are refused -- is a property
 * of this function, and that is what is asserted here.
 *
 * Signal *delivery* is exercised where it is real: the container stop in P0-05.
 */
describe("gracefulShutdown", () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  const listen = (s: Server): Promise<number> =>
    new Promise((resolve) => {
      s.listen(0, "127.0.0.1", () => {
        const address = s.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });

  it("lets an in-flight request finish before resolving", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    server = createServer((_req, res) => {
      void held.then(() => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("finished");
      });
    });
    const port = await listen(server);

    // Start a request and wait until the server has actually received it.
    const inFlight = fetch(`http://127.0.0.1:${port}/slow`);
    await new Promise((r) => setTimeout(r, 50));

    let shutdownResolved = false;
    const draining = gracefulShutdown(server, { timeoutMs: 5_000 }).then(() => {
      shutdownResolved = true;
    });

    // The request is still open, so shutdown must not have completed.
    await new Promise((r) => setTimeout(r, 50));
    expect(shutdownResolved).toBe(false);

    release?.();
    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("finished");

    await draining;
    expect(shutdownResolved).toBe(true);
  });

  it("refuses new connections once draining has started", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    const port = await listen(server);

    await gracefulShutdown(server, { timeoutMs: 5_000 });

    await expect(fetch(`http://127.0.0.1:${port}/after`)).rejects.toThrow();
  });

  it("gives up after the timeout rather than blocking a rollout forever", async () => {
    const neverEnds = new Promise<void>(() => {});
    server = createServer((_req, res) => {
      void neverEnds.then(() => res.end());
    });
    const port = await listen(server);

    void fetch(`http://127.0.0.1:${port}/stuck`).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));

    let timedOut = false;
    const started = Date.now();
    await gracefulShutdown(server, {
      timeoutMs: 200,
      onTimeout: () => (timedOut = true),
    });

    expect(timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
