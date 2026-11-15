// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Adds the Telescopes hero's requests for Barnard's Star ('See 25 years of motion') to web/prebaked/,
// so the live site shows 2MASS, AllWISE and the wide SPHEREx panel without asking IRSA (judging panel
// round 3, item 3: IRSA's SIA answered 502 and cutouts 503 during judging). The answers are copied from
// the local relay's disk cache (.cache/relay, the relay's own processed output: 2MASS unzipped, image HDU
// only), never fetched here. tools/export_prebaked.mjs keeps them on a re-export (prebake_extra.json).
// Usage: node tools/prebake_telescopes.mjs
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'web', 'prebaked'), CACHE = join(ROOT, '.cache', 'relay');
const IRSA = 'https://irsa.ipac.caltech.edu';
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const OWNER = 'barnard';
const KEYS = JSON.parse(readFileSync(join(ROOT, 'tools', 'prebake_extra.json'), 'utf8'))[OWNER].filter(k => k.startsWith('/'));
const kindOf = (k) => (k.startsWith('/SIA?') ? ['sia', '.xml'] : k.startsWith('/ibe/data/spherex/') ? ['cutout', '.fits'] : ['survey', '.fits']);

const man = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
for (const key of KEYS) {
  const cf = join(CACHE, sha1(IRSA + key));
  const bytes = readFileSync(cf), meta = JSON.parse(readFileSync(cf + '.json', 'utf8'));
  if (meta.url !== IRSA + key) throw new Error('cache entry is for another URL: ' + key);
  const [kind, ext] = kindOf(key), file = `${OWNER}/${sha1(key).slice(0, 16)}${ext}`;
  mkdirSync(dirname(join(OUT, file)), { recursive: true });
  writeFileSync(join(OUT, file), bytes);
  man.entries[key] = { file, size: bytes.length, fetched: statSync(cf).mtime.toISOString(), kind,
    source: `IRSA ${meta.url.split('?')[0].replace(IRSA, '')} (via the Star Shift relay), copied from the local relay cache for the Telescopes view` };
  console.log(`${file}  ${bytes.length} B  ${key}`);
}
// totals and the owner's summary, from the entries themselves
const all = Object.entries(man.entries).sort((a, b) => a[0].localeCompare(b[0]));
man.entries = Object.fromEntries(all);
const mib = (b) => Math.round(b / 1048576 * 100) / 100, mine = all.filter(([, e]) => e.file.startsWith(OWNER + '/'));
const t = man.targets[OWNER]; t.files = mine.length; t.mib = mib(mine.reduce((a, [, e]) => a + e.size, 0));
t.kinds = mine.reduce((o, [, e]) => (o[e.kind] = (o[e.kind] || 0) + 1, o), {});
t.telescopes = { note: "'See 25 years of motion': 2MASS Ks and AllWISE W1 image lists and cutouts, and the wide SPHEREx cutout of the first image (tools/prebake_telescopes.mjs)", files: KEYS.length };
const { entries } = man; delete man.entries;
man.totals = { files: all.length + 1, mib: mib(all.reduce((a, [, e]) => a + e.size, 0)) };
man.entries = entries;
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
console.log(`barnard: ${t.files} files, ${t.mib} MiB; total ${man.totals.files} files, ${man.totals.mib} MiB`);
