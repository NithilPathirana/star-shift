// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Adds the Archive page's first-page thumbnails (50 per demo target, 25 px cutouts) to web/prebaked/,
// plus, for the saved targets, the Archive's own image-list requests (SIA/TAP at its SIMBAD position),
// so archive.html?q=<a demo target> asks IRSA nothing (IRSA outage, Sun 15 Nov: cutouts 503 on and off).
// The keys come from tools/prebake_archive.json (read from a real page load); the answers are copied
// from the local relay's disk cache (.cache/relay, the relay's own output), never fetched here.
// Usage: node tools/prebake_archive.mjs
import { readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'web', 'prebaked'), CACHE = join(ROOT, '.cache', 'relay');
const IRSA = 'https://irsa.ipac.caltech.edu';
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const LIST = JSON.parse(readFileSync(join(ROOT, 'tools', 'prebake_archive.json'), 'utf8')); delete LIST.about;

const man = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
let added = 0, missing = 0;
for (const [owner, keys] of Object.entries(LIST)) {
  for (const key of keys) {
    if (man.entries[key]) continue; // already saved (e.g. a viewer cutout)
    const cf = join(CACHE, sha1(IRSA + key));
    if (!existsSync(cf)) { console.log('not in the relay cache:', key); missing++; continue; }
    const bytes = readFileSync(cf), meta = JSON.parse(readFileSync(cf + '.json', 'utf8'));
    if (meta.url !== IRSA + key) throw new Error('cache entry is for another URL: ' + key);
    const kind = key.startsWith('/SIA?') ? 'sia' : key.startsWith('/TAP/sync?') ? 'tap' : 'cutout';
    const file = `${owner}/${sha1(key).slice(0, 16)}${{ sia: '.xml', tap: '.csv', cutout: '.fits' }[kind]}`;
    mkdirSync(dirname(join(OUT, file)), { recursive: true });
    writeFileSync(join(OUT, file), bytes);
    man.entries[key] = { file, size: bytes.length, fetched: statSync(cf).mtime.toISOString(), kind,
      source: kind === 'cutout' ? 'IRSA SPHEREx cutout (via the Star Shift relay), copied from the local relay cache for the Archive page thumbnails'
        : `IRSA SPHEREx ${kind === 'sia' ? 'SIA' : 'TAP'} image list (via the Star Shift relay), copied from the local relay cache for the Archive page` };
    added++;
  }
  const t = man.targets[owner] || man.savedTargets?.[owner]; // NASA's five or a saved target (--add)
  if (t) {
    const mine = Object.values(man.entries).filter(e => e.file.startsWith(owner + '/'));
    t.files = mine.length; t.mib = Math.round(mine.reduce((a, e) => a + e.size, 0) / 1048576 * 100) / 100;
    t.kinds = mine.reduce((o, e) => (o[e.kind] = (o[e.kind] || 0) + 1, o), {});
    t.archive = { note: "Archive page: the first page's 50 thumbnails (tools/prebake_archive.mjs)", files: keys.length };
  }
}
const all = Object.entries(man.entries).sort((a, b) => a[0].localeCompare(b[0]));
delete man.entries;
man.totals = { files: all.length + 1, mib: Math.round(all.reduce((a, [, e]) => a + e.size, 0) / 1048576 * 100) / 100 };
man.entries = Object.fromEntries(all);
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
console.log(`Added ${added} Archive thumbnails (${missing} missing). Total ${man.totals.files} files, ${man.totals.mib} MiB.`);
