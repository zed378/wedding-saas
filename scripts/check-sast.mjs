#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// P5-14: checked-in rules, no remote registry, metrics, credentials or network.
const image =
  "semgrep/semgrep@sha256:6e1b04340e60e910fbb4ddbf3c857ab0918f064417ad5ac530014ccb3cf8c8f1";
const root = fileURLToPath(new URL("../", import.meta.url));
const packageSources = readdirSync(new URL("../packages/", import.meta.url))
  .map((name) => `packages/${name}/src`)
  .filter((path) => existsSync(resolve(root, path)));
const sources = [
  "backend/api/src",
  "backend/worker/src",
  "frontend/web-app/src",
  "frontend/public-invite/src",
  "admin/src",
  ...packageSources,
];
// Docker Desktop's Windows bind-mount metadata traversal is extremely slow.
// Snapshot only analyzed source; the container extracts it into its own filesystem.
const staging = mkdtempSync(join(tmpdir(), "wi-sast-"));
process.on("exit", () => rmSync(staging, { recursive: true, force: true }));
const archive = join(staging, "source.tar");
const snapshot = spawnSync(
  "tar",
  ["-cf", archive, "security/semgrep", "security/semgrep-tests", ...sources],
  { cwd: root, encoding: "utf8" },
);
if (snapshot.error || snapshot.status !== 0) {
  console.error("SAST requires tar to snapshot the application sources.");
  console.error(snapshot.error?.message ?? snapshot.stderr);
  process.exit(1);
}
const common = [
  "run",
  "--rm",
  "--network",
  "none",
  "-e",
  "SEMGREP_SEND_METRICS=off",
  "-e",
  "SEMGREP_ENABLE_VERSION_CHECK=0",
  "-v",
  `${archive}:/input/source.tar:ro`,
  "--entrypoint",
  "sh",
  image,
  "-c",
  'mkdir -p /src && tar -xf /input/source.tar -C /src && cd /src && exec "$@"',
  "--",
  "semgrep",
];
const options = [
  "--config",
  "security/semgrep",
  "--metrics=off",
  "--disable-version-check",
];

function run(args) {
  const result = spawnSync("docker", [...common, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    console.error(`SAST requires Docker: ${result.error.message}`);
    process.exit(1);
  }
  return result;
}

const tests = run(["--test", ...options, "security/semgrep-tests"]);
process.stdout.write(tests.stdout ?? "");
if (tests.status !== 0) {
  process.stderr.write(tests.stderr ?? "");
  process.exit(1);
}
if (process.argv.includes("--test")) process.exit(0);

const scan = run([
  "scan",
  ...options,
  "--strict",
  "--error",
  "--json",
  "--no-git-ignore",
  "--disable-nosem",
  "--jobs=2",
  "--exclude=**/node_modules/**",
  "--exclude=**/dist/**",
  "--exclude=**/*.spec.*",
  "--exclude=**/*.test.*",
  "--exclude=**/__tests__/**",
  ...sources,
]);
let report;
try {
  report = JSON.parse(scan.stdout);
} catch {
  console.error("SAST failed to produce a JSON report.");
  process.stderr.write(scan.stderr ?? "");
  process.exit(1);
}
for (const finding of report.results ?? []) {
  console.error(
    `${finding.path}:${finding.start.line} ${finding.check_id}: ${finding.extra.message}`,
  );
}
for (const error of report.errors ?? []) {
  console.error(error.message ?? JSON.stringify(error));
}
const files = report.paths?.scanned?.length ?? 0;
const findings = report.results?.length ?? 0;
const errors = report.errors?.length ?? 0;
console.log(
  `SAST: ${files} files scanned, ${findings} findings, ${errors} analysis errors.`,
);
process.exit(
  scan.status === 0 && files > 0 && findings === 0 && errors === 0 ? 0 : 1,
);
