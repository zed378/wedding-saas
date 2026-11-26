# Local static security analysis

Run `pnpm check:sast` (or `node scripts/check-sast.mjs`). Docker must be running and
the operating system's `tar` executable must be available (included with Windows
and typical Linux installations).
The first invocation downloads the Semgrep 1.186.0 image, pinned by SHA-256 digest
in the runner. Later invocations use that exact image. Updating the image is an
explicit reviewed change, followed by rule tests and a complete scan.

The runner first tests every rule against positive and negative fixtures. It then
scans application source under the API, worker, both frontends, admin and every
`packages/*/src` directory. Tests, generated output, dependencies, deployment
scripts and other tooling are outside this scan. Existing `scripts/check-*.mjs`
provide additional project-specific security gates. Run only the rule fixtures
with `node scripts/check-sast.mjs --test`.

The checked-in AST and intra-procedural taint rules detect string-based JavaScript
execution, shell command-string APIs, disabled TLS verification, unsigned JWT
configuration, MD5, request values reaching raw SQL, and request/location values
reaching raw DOM HTML. These are bounded checks, not a complete vulnerability
catalog. In particular, taint analysis does not prove ownership filtering, trace
Nest DTO values across service boundaries, or verify payment signatures.
Authorization, payment, upload and sanitization still require their named unit,
real-database and browser tests, plus the pre-launch security review.

The runner archives only the selected source and rule directories into an OS
temporary directory, mounts the archive read-only and extracts it inside a
container with no network. This avoids Docker Desktop's slow traversal of Windows
bind-mounted source directories. The temporary archive is removed on normal exit;
an externally killed Node process may leave a `wi-sast-*` directory in the OS temp
folder. The archive contains application source, so treat it like the checkout.
Metrics and version checks are disabled. Registry rules, login credentials,
cloud analysis, suppression comments and an accepted-finding baseline are not used.
Findings, parser/analysis errors, tool failures and an empty scan fail the command.
`scripts/verify.sh` runs this gate in full mode; fast pre-push checks remain a
smaller set. CI automation is still deferred under ADR-028.
