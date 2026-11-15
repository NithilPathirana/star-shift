// The logo credit says "SI-generated" everywhere (Nithil, Sun 15 Nov 2026). This fails if the old
// wording ("Logo: AI-generated", "AI-generated (SI)") is anywhere under web/, prebaked data included.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const TEXT = /\.(html|js|mjs|css|json|csv|md|svg|txt|xml)$/i;
const OLD = /Logo: AI-generated|AI-generated \(SI\)|Built with AI/; // Nithil: 'SI' wording, never 'Built with AI'
function walk(dir) { return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : TEXT.test(n) ? [p] : []; }); }

test('no old "AI-generated" logo wording anywhere in web/', () => {
  const hits = walk(root).filter(f => OLD.test(readFileSync(f, 'utf8'))).map(f => f.slice(root.length));
  assert.deepEqual(hits, []);
});
test('the visible credit line uses the exact approved text', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, /Logo: SI-generated with ChatGPT; small version and favicon redrawn as SVG by Claude\./);
});
