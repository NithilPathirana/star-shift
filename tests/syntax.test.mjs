// Every browser script must parse. ui.js and other page modules are never imported by the node tests
// (they need a DOM), so a syntax slip there passed npm test and blanked the app (Sun 15 Nov, 3c42b80).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const SKIP = /(^|[\/])(vendor|prebaked|loader)([\/]|$)/;
function jsFiles(dir) {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n);
    if (SKIP.test(p.slice(root.length))) return [];
    return statSync(p).isDirectory() ? jsFiles(p) : /\.m?js$/.test(n) ? [p] : []; });
}
const check = (f) => new Promise(res => execFile(process.execPath, ['--check', f], (err, _o, se) => res(err ? `${f}: ${se.split('\n').slice(0, 4).join(' ')}` : null)));

test('every web/ script parses (node --check; package type is module)', async () => {
  const files = jsFiles(root), bad = [];
  for (let i = 0; i < files.length; i += 12) bad.push(...(await Promise.all(files.slice(i, i + 12).map(check))).filter(Boolean));
  assert.ok(files.length > 30, `found ${files.length} scripts`);
  assert.deepEqual(bad, []);
});
