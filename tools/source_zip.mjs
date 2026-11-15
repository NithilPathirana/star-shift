// Builds web/source.zip: the project's source as committed (tracked files only, from HEAD), so the
// site can offer "Download the source" without a code host. Leaves out build folders, logs and env files.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Usage: npm run source-zip   (commit first: uncommitted edits are not in the zip)
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { EXCLUDE, scan } from './source_scan.mjs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = 'web/source.zip';
// EXCLUDE (tools/source_scan.mjs) leaves out build folders, logs, env files and web/prebaked (the cached
// archive answers, rebuilt by tools/export_prebaked.mjs); the scan checks exactly that file list first
const problems = scan(root);
if (problems.length) { console.error('source scan failed, no zip written:\n' + problems.join('\n')); process.exit(1); }
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim();
if (dirty) console.warn('note: uncommitted changes are NOT in the zip (it is built from HEAD):\n' + dirty);
execFileSync('git', ['archive', '--format=zip', '--prefix=star-shift/', '-o', out, 'HEAD', '--', '.', ...EXCLUDE], { cwd: root, stdio: 'inherit' });
const list = execFileSync('git', ['archive', '--format=tar', 'HEAD', '--', '.', ...EXCLUDE], { cwd: root, maxBuffer: 1 << 30 });
const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
console.log(`wrote ${out} from ${head}: ${(statSync(new URL('../' + out, import.meta.url)).size / 1048576).toFixed(1)} MiB (tar ${(list.length / 1048576).toFixed(1)} MiB)`);
