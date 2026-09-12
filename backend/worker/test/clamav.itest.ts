import { beforeAll, describe, expect, it } from "vitest";
import { connect } from "node:net";

import { scan, ScannerUnavailableError } from "../src/media/clamav.js";

/**
 * P1-18 — the clamd client against a real clamd.
 *
 * `media-unit.spec.ts` covers how a reply is *interpreted*; this covers whether the bytes
 * this code puts on the socket produce that reply at all. The two halves fail differently
 * and only one of them can be checked without a container: an `INSTREAM` chunk header
 * written little-endian parses as an enormous length, and clamd simply waits — which looks
 * like a hang rather than a bug, and no unit test would ever see it.
 *
 *   docker compose -f deploy/docker-compose.yml --profile media up -d clamav
 *   CLAMAV_HOST=localhost pnpm --filter @wi/worker test:integration clamav
 *
 * **EICAR is not malware.** It is the industry's standard 68-byte test string, published by
 * EICAR precisely so that scanners can be verified without anybody handling a real sample.
 * Every engine detects it; it does nothing if executed.
 */

const HOST = process.env["CLAMAV_HOST"] ?? "localhost";
const PORT = Number(process.env["CLAMAV_PORT"] ?? "3310");

/**
 * The EICAR test string, assembled at runtime.
 *
 * Split so this source file does not itself contain the sequence — otherwise the repository
 * is a file a corporate scanner quarantines on checkout, and the test that proves the
 * scanner works becomes the reason nobody can clone the repository.
 */
const EICAR = Buffer.from(
  [
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}",
    "$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!",
    "$H+H*",
  ].join(""),
);

const CLEAN = Buffer.from(
  "a perfectly ordinary file with no signature in it at all",
);

async function reachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: HOST, port: PORT });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(3_000, () => done(false));
    socket.on("error", () => done(false));
    socket.on("connect", () => done(true));
  });
}

describe("clamd INSTREAM (docs/SECURITY/06 layer 10)", () => {
  beforeAll(async () => {
    if (!(await reachable())) {
      // Fails rather than skips, like every other integration suite here. A scanner suite
      // that skips reports green for the control it exists to prove.
      throw new Error(
        [
          `No clamd at ${HOST}:${String(PORT)}.`,
          "",
          "  docker compose -f deploy/docker-compose.yml --profile media up -d clamav",
          "",
          "First start downloads the signature database and takes a couple of minutes.",
          "",
        ].join("\n"),
      );
    }
  }, 30_000);

  it("calls an ordinary file clean", async () => {
    await expect(
      scan(new Uint8Array(CLEAN), { host: HOST, port: PORT }),
    ).resolves.toEqual({ verdict: "clean" });
  });

  it("detects the EICAR test file and names the signature", async () => {
    const result = await scan(new Uint8Array(EICAR), {
      host: HOST,
      port: PORT,
    });

    expect(result.verdict).toBe("infected");
    expect((result as { signature: string }).signature.toLowerCase()).toContain(
      "eicar",
    );
  });

  it("streams a file larger than one INSTREAM chunk", async () => {
    // The chunking loop is where a length-prefix bug hides, and a single-chunk file would
    // exercise it once and pass with the loop written wrong. 200 KB is four chunks.
    //
    // The assertion is `clean`, not `infected`, and the first version of this test got that
    // wrong: it appended EICAR after 200 KB of padding and expected a detection. ClamAV
    // returned clean and ClamAV was right — the EICAR specification defines the signature
    // only within the first 128 bytes of a file, so a padded copy is genuinely not the test
    // file any more. The test was wrong, not the client.
    //
    // `clean` still discriminates. A length prefix written little-endian makes clamd wait
    // for a chunk of 2^24 bytes that never arrives, and this resolves as a timeout —
    // `ScannerUnavailableError`, not a verdict. Reaching `clean` at all means every chunk
    // header was read as the length it was meant to be.
    const big = Buffer.alloc(200 * 1024, 0x41);

    const result = await scan(new Uint8Array(big), { host: HOST, port: PORT });

    expect(result.verdict).toBe("clean");
  }, 20_000);

  it("reports an unreachable scanner rather than calling the file clean", async () => {
    // Fail closed. Port 1 has nothing on it.
    await expect(
      scan(new Uint8Array(CLEAN), { host: "127.0.0.1", port: 1 }),
    ).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it("times out rather than hanging forever", async () => {
    // A blackhole address: the connection neither completes nor is refused.
    await expect(
      scan(new Uint8Array(CLEAN), {
        host: "192.0.2.1",
        port: 3310,
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(ScannerUnavailableError);
  }, 15_000);
});
