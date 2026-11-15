// Builds web/source.zip: the project's source as committed (tracked files only, from HEAD), so the
// site can offer "Download the source" without a code host. Leaves out build folders, logs and env files.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Usage: npm run source-zip   (commit first: uncommitted edits are not in the zip)
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = 'web/source.zip';
const EXCLUDE = [':(exclude,glob)**/_build/**', ':(exclude,glob)**/*.log', ':(exclude,glob)**/.env*', ':(exclude,glob)**/*.env',
  ':(exclude,glob)**/.dev.vars', ':(exclude)web/source.zip',
  ':(exclude)web/prebaked']; // cached archive answers, not source: rebuilt by tools/export_prebaked.mjs
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim();
if (dirty) console.warn('note: uncommitted changes are NOT in the zip (it is built from HEAD):\n' + dirty);
execFileSync('git', ['archive', '--format=zip', '--prefix=star-shift/', '-o', out, 'HEAD', '--', '.', ...EXCLUDE], { cwd: root, stdio: 'inherit' });
const list = execFileSync('git', ['archive', '--format=tar', 'HEAD', '--', '.', ...EXCLUDE], { cwd: root, maxBuffer: 1 << 30 });
const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
console.log(`wrote ${out} from ${head}: ${(statSync(new URL('../' + out, import.meta.url)).size / 1048576).toFixed(1)} MiB (tar ${(list.length / 1048576).toFixed(1)} MiB)`);
