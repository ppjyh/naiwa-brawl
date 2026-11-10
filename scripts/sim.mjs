import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';

mkdirSync('tmp', { recursive: true });
buildSync({
  entryPoints: ['src/sim/batch.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'tmp/batch.cjs',
  logLevel: 'warning',
});

const args = process.argv.slice(2);
const run = spawnSync(process.execPath, ['tmp/batch.cjs', ...args], { stdio: 'inherit' });
process.exit(run.status ?? 1);
