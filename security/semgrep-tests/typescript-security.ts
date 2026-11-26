import { execFile } from "node:child_process";
// ruleid: shell-command-string
import { exec as runCommand } from "node:child_process";
import * as childProcess from "node:child_process";
// ruleid: shell-command-string
childProcess.exec("convert " + inputPath);

// ruleid: dynamic-code-execution
eval(untrustedCode);
// ruleid: dynamic-code-execution
new Function("return " + untrustedCode);
// ok: dynamic-code-execution
JSON.parse(untrustedCode);
// ok: shell-command-string
execFile("convert", [inputPath, outputPath]);

// ruleid: disabled-tls-verification
const insecureTls = { rejectUnauthorized: false };
// ruleid: disabled-tls-verification
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// ok: disabled-tls-verification
const secureTls = { rejectUnauthorized: true };

// ruleid: unsigned-jwt
const unsignedJwt = { algorithms: ["none"] };
// ok: unsigned-jwt
const signedJwt = { algorithms: ["RS256"] };

// ruleid: weak-md5-digest
createHash("md5").update(secret);
// ok: weak-md5-digest
createHash("sha256").update(secret);

const userFilter = req.query;
// ruleid: request-data-to-raw-sql
sql.raw("SELECT * FROM users WHERE email = '" + userFilter.email + "'");
// ok: request-data-to-raw-sql
sql`SELECT id FROM users WHERE email = ${userFilter.email}`;
// ok: request-data-to-raw-sql
sql.raw("SELECT id FROM users WHERE status = 'active'");
// ok: request-data-to-raw-sql
pool.query("SELECT 1");
// ok: request-data-to-raw-sql
pool.query("SELECT id FROM users WHERE email = $1", [userFilter.email]);

const message = req.body;
// ruleid: request-data-to-dom-html
element.innerHTML = message.text;
// ruleid: request-data-to-dom-html
document.write(window.location.hash);
// ruleid: request-data-to-dom-html
const htmlProps = { __html: message.text };
// ok: request-data-to-dom-html
element.textContent = message.text;
