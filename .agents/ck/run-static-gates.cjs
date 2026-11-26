const fs = require('node:fs');
const cp = require('node:child_process');
let failed = 0;
for (const file of fs.readdirSync('scripts').filter((name) => /^check-.*\.mjs$/.test(name))) {
  const result = cp.spawnSync(process.execPath, ['scripts/' + file], { encoding: 'utf8' });
  console.log(file + ': ' + result.status + '\n' + (result.stdout + result.stderr).trim());
  if (result.status !== 0) failed++;
}
process.exitCode = failed ? 1 : 0;
