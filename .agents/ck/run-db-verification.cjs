const cp = require('node:child_process');
const path = require('node:path');
const root = process.cwd();
const container = 'wedding-p5-admin-tests-20261125';
function command(args) {
  return cp.execFileSync('rtk', ['proxy', ...args], { encoding: 'utf8' });
}
const info = JSON.parse(command(['docker', 'inspect', container]))[0];
const config = Object.fromEntries(info.Config.Env.map((entry) => {
  const index = entry.indexOf('=');
  return [entry.slice(0, index), entry.slice(index + 1)];
}));
const database = 'wedding_phase5_verify_' + Date.now();
command(['docker', 'exec', container, 'psql', '-U', config.POSTGRES_USER, '-d', 'postgres', '-c', 'CREATE DATABASE ' + database]);
const port = info.NetworkSettings.Ports['5432/tcp'][0].HostPort;
const url = 'postgres://' + encodeURIComponent(config.POSTGRES_USER) + ':' + encodeURIComponent(config.POSTGRES_PASSWORD) + '@127.0.0.1:' + port + '/' + database;
console.log('Running isolated PostgreSQL verification in ' + database);
const result = cp.spawnSync('rtk', ['proxy', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.mts',
  'test/integration/admin-mfa-session.itest.ts',
  'test/integration/admin-invitations.itest.ts',
  'test/integration/admin-dashboard.itest.ts',
  'test/integration/admin-audit-logs.itest.ts',
  'test/integration/admin-slug-blocklist.itest.ts',
  'test/integration/auth-session.itest.ts',
  'test/integration/google-oauth.itest.ts',
  '--pool=threads', '--maxWorkers=1', '--hookTimeout=120000', '--testTimeout=30000'], {
  cwd: path.join(root, 'backend/api'), stdio: 'inherit',
  env: { ...process.env, TEST_DATABASE_URL: url },
});
process.exitCode = result.status ?? 1;
