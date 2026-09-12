import { connect, type Socket } from "node:net";

/**
 * P1-18 — `docs/SECURITY/06` layer 10, the malware scan.
 *
 * ## Why this is 80 lines instead of a dependency
 *
 * clamd's `INSTREAM` protocol is: send `zINSTREAM\0`, then length-prefixed chunks, then a
 * zero-length chunk, then read one line. That is the whole thing. The npm wrappers around it
 * add process spawning, file-path modes and a configuration surface this project does not
 * want — and they add a dependency to the code path whose job is deciding whether a file is
 * hostile. `P1-17` made the same call about magic bytes for the same reason.
 *
 * ## Fail closed, always
 *
 * Every failure — a refused connection, a timeout, a reply this code does not recognise —
 * raises `ScannerUnavailableError`. It is never `clean`. `docs/SECURITY/00` § Core Security
 * Principles requires failing closed on anything security-relevant, and an unscanned file
 * that reached `ready` is exactly the outcome layer 10 exists to prevent.
 *
 * The distinction between "unavailable" and "infected" is load-bearing and the caller acts
 * on it: unavailable is a transient condition worth retrying, infected is a permanent verdict
 * that must not be retried into a different answer.
 */

export type ScanResult =
  | { readonly verdict: "clean" }
  | { readonly verdict: "infected"; readonly signature: string };

/** The scanner could not give an answer. Retry; never treat as clean. */
export class ScannerUnavailableError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(`malware scanner unavailable: ${message}`);
    this.name = "ScannerUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}

export interface ClamavOptions {
  readonly host: string;
  readonly port: number;
  /** Whole-scan budget. A scan that hangs must not hold a media worker slot forever. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** clamd rejects a chunk larger than its StreamMaxLength; 64 KiB is comfortably under. */
const CHUNK_BYTES = 64 * 1024;

/**
 * Scan bytes with clamd over `INSTREAM`.
 *
 * The reply is one line: `stream: OK`, `stream: <Signature> FOUND`, or
 * `INSTREAM size limit exceeded. ERROR`. Anything else is unavailability rather than a
 * verdict — this code refuses to guess what an unrecognised line means.
 */
export async function scan(
  bytes: Uint8Array,
  options: ClamavOptions,
): Promise<ScanResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const reply = await exchange(bytes, options, timeoutMs);
  return interpret(reply);
}

/**
 * Turn one clamd reply line into a verdict.
 *
 * Exported so the protocol's edge cases are unit-testable without a socket: the three
 * replies that matter are three strings, and a test that had to start a container to check
 * them is a test nobody runs.
 */
export function interpret(reply: string): ScanResult {
  const line = reply.replace(/\0/g, "").trim();

  if (/\bOK$/.test(line)) return { verdict: "clean" };

  const found = /^stream:\s*(.+?)\s+FOUND$/.exec(line);
  if (found !== null) {
    return { verdict: "infected", signature: found[1]! };
  }

  // `... ERROR`, an empty line, or anything unrecognised. NOT clean: a scanner that said
  // something this code does not understand has not said the file is safe.
  throw new ScannerUnavailableError(
    `unrecognised reply ${JSON.stringify(line.slice(0, 120))}`,
  );
}

function exchange(
  bytes: Uint8Array,
  options: ClamavOptions,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks: Buffer[] = [];

    const finish = (error: Error | null, reply?: string): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error !== null) reject(error);
      else resolve(reply!);
    };

    const socket: Socket = connect({
      host: options.host,
      port: options.port,
    });

    socket.setTimeout(timeoutMs, () => {
      finish(new ScannerUnavailableError(`no reply within ${timeoutMs}ms`));
    });

    socket.on("error", (cause) => {
      finish(new ScannerUnavailableError("connection failed", cause));
    });

    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    socket.on("end", () => {
      finish(null, Buffer.concat(chunks).toString("utf8"));
    });

    socket.on("connect", () => {
      socket.write("zINSTREAM\0");

      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        const slice = bytes.subarray(offset, offset + CHUNK_BYTES);
        const header = Buffer.alloc(4);
        // Network byte order. clamd reads this as a uint32be and will desynchronise
        // silently on little-endian, which looks like a hang rather than an error.
        header.writeUInt32BE(slice.length, 0);
        socket.write(header);
        socket.write(slice);
      }

      // The zero-length chunk that ends the stream.
      socket.write(Buffer.alloc(4));
    });
  });
}
