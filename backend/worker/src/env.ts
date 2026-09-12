/**
 * P1-18 — the worker's environment.
 *
 * The API validates its whole environment at boot and exits 78 naming every offending
 * variable (`backend/api/src/config/env.schema.ts`). The worker had only `REDIS_URL`, read
 * inline, because until now it did nothing but move jobs around. It now needs a database, a
 * bucket and a malware scanner, and each of those has a failure mode that is much worse
 * discovered on the first job than at startup.
 *
 * Kept deliberately small: this is not a second copy of the API's schema, it is the handful
 * of variables the media pool cannot run without. Zod is not a worker dependency and adding
 * it for six variables would be the wrong trade.
 */

export interface WorkerEnv {
  readonly appEnv: "development" | "test" | "staging" | "production";
  readonly redisUrl: string;
  readonly databaseUrl: string;
  readonly storage: {
    readonly endpoint: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly buckets: {
      readonly "user-media": string;
      readonly "template-assets": string;
      readonly staging: string;
    };
  };
  /** `undefined` only when the scan has been deliberately disabled in development. */
  readonly clamav: { host: string; port: number } | undefined;
}

export class WorkerConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(
      [
        "The worker cannot start with this environment:",
        "",
        ...problems.map((p) => `  - ${p}`),
        "",
        "See .env.example.",
      ].join("\n"),
    );
    this.name = "WorkerConfigError";
  }
}

const DEPLOYED = new Set(["staging", "production"]);

/**
 * Read and validate. Throws `WorkerConfigError` naming **every** problem, not the first.
 *
 * `pool` matters because the requirements differ: `general` needs Redis and nothing else
 * today, while `media` needs a database, a bucket and a scanner. Demanding storage
 * credentials of an email worker would be the kind of over-strict validation that gets
 * loosened by someone in a hurry, and the loosening would apply to the media pool too.
 */
export function loadWorkerEnv(
  pool: "media" | "general" | "cron",
  source: NodeJS.ProcessEnv = process.env,
): WorkerEnv {
  const problems: string[] = [];

  const required = (name: string): string => {
    const value = source[name];
    if (value === undefined || value.length === 0) {
      problems.push(`${name} is required`);
      return "";
    }
    return value;
  };

  const appEnvRaw = source["APP_ENV"] ?? source["NODE_ENV"] ?? "development";
  const appEnv =
    appEnvRaw === "test" ||
    appEnvRaw === "staging" ||
    appEnvRaw === "production"
      ? appEnvRaw
      : "development";

  const redisUrl = required("REDIS_URL");

  // `media` processes files; `cron` runs the staging sweep, which also needs both.
  const needsMedia = pool === "media" || pool === "cron";

  const databaseUrl = needsMedia ? required("DATABASE_URL") : "";
  const endpoint = needsMedia ? required("STORAGE_ENDPOINT") : "";
  const accessKeyId = needsMedia ? required("STORAGE_ACCESS_KEY_ID") : "";
  const secretAccessKey = needsMedia
    ? required("STORAGE_SECRET_ACCESS_KEY")
    : "";

  /**
   * The scanner, and the one place this file makes a security decision.
   *
   * `docs/SECURITY/06` layer 10 is mandatory, and `docs/SECURITY/00` says fail closed. So a
   * media worker with no `CLAMAV_HOST` **refuses to start** — the alternative is a worker
   * that quietly publishes unscanned files, which is indistinguishable from a working one
   * until it matters.
   *
   * `MEDIA_SCAN_DISABLED=true` is the escape hatch for a laptop with no ClamAV container,
   * and it is refused outright in staging and production. A skipped scan has to be something
   * somebody chose and can see in the process's own startup log, never an absent variable.
   */
  let clamav: { host: string; port: number } | undefined;

  if (pool === "media") {
    const disabled = source["MEDIA_SCAN_DISABLED"] === "true";

    if (disabled && DEPLOYED.has(appEnv)) {
      problems.push(
        `MEDIA_SCAN_DISABLED must not be set in ${appEnv}. docs/SECURITY/06 layer 10 is mandatory`,
      );
    } else if (!disabled) {
      const host = source["CLAMAV_HOST"];
      if (host === undefined || host.length === 0) {
        problems.push(
          "CLAMAV_HOST is required for the media pool. Set MEDIA_SCAN_DISABLED=true to run without a scanner in development",
        );
      } else {
        const port = Number(source["CLAMAV_PORT"] ?? "3310");
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          problems.push("CLAMAV_PORT must be a port number");
        }
        clamav = { host, port };
      }
    }
  }

  if (problems.length > 0) throw new WorkerConfigError(problems);

  return {
    appEnv,
    redisUrl,
    databaseUrl,
    storage: {
      endpoint,
      accessKeyId,
      secretAccessKey,
      buckets: {
        "user-media": source["STORAGE_BUCKET_USER_MEDIA"] ?? "user-media",
        "template-assets":
          source["STORAGE_BUCKET_TEMPLATE_ASSETS"] ?? "template-assets",
        staging: source["STORAGE_BUCKET_STAGING"] ?? "staging",
      },
    },
    clamav,
  };
}
