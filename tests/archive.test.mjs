// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Observation Archive table logic: rows, bands, seasons, sort/filter/page, flags, CSV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mjdToUtc, releaseOf, bandFor, bandAt, seasonsOf, toRows, sortRows, filterRows, paginate, summarizeFlags, kindOfName,
  rowsToCSV, csvCell, viewerUrl, targetViewerUrl, flagText,
} from '../web/app/archive/logic.js';

const im = (mjd, det, rel = 'dr1', min = 0.7455, max = 1.1167) => ({
  uri: `ibe/data/spherex/${rel}/level2/x/${det}/img_${mjd}_D${det}.fits`, mjdStart: mjd, mjdEnd: mjd + 0.0013, detector: det,
  bandMinUm: min, bandMaxUm: max, obsid: `obs_${mjd}`,
});

test('MJD to UTC date and time', () => {
  assert.equal(mjdToUtc(60902.864715).date, '2025-08-15');
  assert.equal(mjdToUtc(60902.5).time, '12:00:00');
  assert.equal(mjdToUtc(NaN).date, '—');
});

test('data release from the uri', () => {
  assert.equal(releaseOf('ibe/data/spherex/qr3/level2/2026W39_1A/l2b/5/a.fits'), 'qr3');
  assert.equal(releaseOf('ibe/data/spherex/dr1/level2/a.fits'), 'dr1');
  assert.equal(releaseOf('nonsense'), '—');
});

test('band names follow the detector ranges', () => {
  const det = [[0.7455, 1.1167, 'Starlight'], [1.1033, 1.6499, 'Cool Stars'], [1.6301, 2.4346, 'Through the Dust'],
    [2.4027, 3.8473, 'Water Ice'], [3.8113, 4.43, 'CO₂ Ice'], [4.4115, 5.0096, 'Brown Dwarfs']];
  for (const [a, b, name] of det) assert.equal(bandFor(a, b).name, name);
  assert.equal(bandFor(NaN, 1), null);
  assert.equal(bandAt(3.05).name, 'Water Ice');
  assert.equal(bandAt(4.27).name, 'CO₂ Ice');
  assert.equal(bandAt(5.0096).name, 'Brown Dwarfs');
});

test('seasons split on gaps over 60 days', () => {
  const s = seasonsOf([60900, 60905, 60910, 61080, 61085, 61300]);
  assert.equal(s.length, 3);
  assert.deepEqual(s.map(x => x.n), [3, 2, 1]);
  assert.match(s[0].label, /Aug 2025/);
});

test('all-year coverage (near the ecliptic poles) is split at its largest gaps into runs of at most ~6 months', () => {
  const mjds = []; for (let m = 60800; m <= 61300; m += 10) if (m < 60950 || m > 60980) mjds.push(m); // 500 days, one 40-day gap
  const s = seasonsOf(mjds);
  assert.ok(s.length >= 3, `got ${s.length}`);
  assert.ok(s.every(x => x.endMjd - x.startMjd <= 183));
  assert.equal(s[0].endMjd, 60940, 'first cut at the 40-day gap');
  assert.equal(s.reduce((a, x) => a + x.n, 0), mjds.length);
  assert.ok(s.every(x => x.endMjd - x.startMjd >= 60), 'no sliver seasons: ' + s.map(x => x.endMjd - x.startMjd));
});

const rows = toRows([im(61085, 2, 'qr3', 1.1033, 1.6499), im(60900, 1), im(60905, 6, 'dr1', 4.4115, 5.0096), im(61300, 4, 'qr3', 2.4027, 3.8473)]);

test('rows are time-ordered and numbered', () => {
  assert.deepEqual(rows.map(r => r.n), [1, 2, 3, 4]);
  assert.deepEqual(rows.map(r => r.detector), [1, 6, 2, 4]);
  assert.deepEqual(rows.map(r => r.season), [0, 0, 1, 2]);
  assert.equal(rows[0].band, 'Starlight');
  assert.equal(rows[0].irsaUrl, 'https://irsa.ipac.caltech.edu/' + rows[0].uri);
  assert.equal(rows[3].release, 'qr3');
});

test('sorting: both directions, stable, unknown flags last', () => {
  assert.deepEqual(sortRows(rows, 'detector').map(r => r.detector), [1, 2, 4, 6]);
  assert.deepEqual(sortRows(rows, 'detector', 'desc').map(r => r.detector), [6, 4, 2, 1]);
  assert.deepEqual(sortRows(rows, 'release').map(r => r.release), ['dr1', 'dr1', 'qr3', 'qr3']);
  const withFlags = rows.map((r, i) => ({ ...r, flags: i === 1 ? { flagged: 5 } : i === 3 ? { flagged: 0 } : null }));
  assert.deepEqual(sortRows(withFlags, 'flags').map(r => r.n), [4, 2, 1, 3]);
  assert.deepEqual(sortRows(withFlags, 'flags', 'desc').map(r => r.n), [2, 4, 1, 3]);
});

test('filters combine', () => {
  assert.equal(filterRows(rows, { detector: '6' }).length, 1);
  assert.equal(filterRows(rows, { release: 'qr3' }).length, 2);
  assert.equal(filterRows(rows, { season: '0', release: 'dr1' }).length, 2);
  assert.equal(filterRows(rows, { season: 0, detector: 2 }).length, 0);
  assert.equal(filterRows(rows, { band: 'd-waterice' }).length, 1);
  assert.equal(filterRows(rows, { text: 'OBS_61300' }).length, 1);
  assert.equal(filterRows(rows, { hasFlags: 'unchecked' }).length, 4);
  const f = rows.map((r, i) => ({ ...r, flags: i ? { flagged: i - 1 } : null }));
  assert.equal(filterRows(f, { hasFlags: 'yes' }).length, 2);
  assert.equal(filterRows(f, { hasFlags: 'no' }).length, 1);
});

test('pagination handles 2,500 rows and clamps the page', () => {
  const many = Array.from({ length: 2500 }, (_, i) => ({ n: i + 1 }));
  const p = paginate(many, 99, 100);
  assert.equal(p.pages, 25); assert.equal(p.page, 24); assert.equal(p.rows.length, 100); assert.equal(p.from, 2401); assert.equal(p.to, 2500);
  assert.equal(paginate([], 3, 50).pages, 1);
  assert.equal(paginate([], 3, 50).from, 0);
});

test('flag summary by kind uses the real bit names', () => {
  const flagNames = { 1: { name: 'TRANSIENT' }, 2: { name: 'OVERFLOW' }, 4: { name: 'GHOST_FPA' }, 8: { name: 'SOURCE' }, 16: { name: 'HOT' }, 32: { name: 'SNOWBALL' } };
  const flags = [0, 1, 2, 4, 8, 16, 1 | 2, 8 | 4, 32];
  const s = summarizeFlags(flags, flagNames);
  assert.equal(s.total, 9);
  assert.equal(s.flagged, 7); // SOURCE alone is not a problem
  assert.equal(s.cosmic, 3); assert.equal(s.overflow, 2); assert.equal(s.scatter, 2); assert.equal(s.other, 1);
  assert.equal(s.byName.SOURCE, 2);
  assert.equal(kindOfName('FULLSAMPLE'), null);
  assert.equal(kindOfName('GHOST_EXT'), 'scatter');
  assert.equal(kindOfName('HALO'), 'cosmic');
  assert.equal(flagText(s), '7 of 9 (cosmic rays 3, overflow 2, scattered light 2, other 1)');
  assert.equal(summarizeFlags([1, 0, 2], flagNames, [1]).total, 1);
});

test('CSV escapes and includes the IRSA link', () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell(null), '');
  const csv = rowsToCSV(rows, seasonsOf(rows.map(r => r.mjd)));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^n,date_utc,time_utc,mjd_start/);
  assert.match(lines[1], /https:\/\/irsa\.ipac\.caltech\.edu\/ibe\/data\/spherex\/dr1\//);
});

test('viewer link', () => {
  assert.equal(viewerUrl(269.446, 4.768), 'index.html?ra=269.44600&dec=4.76800&scene=viewer');
  assert.match(viewerUrl(1, -2, 60900.5), /&mjd=60900\.50000$/);
});

// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
test('Play link: a built-in target goes by name (?q=), any other patch by ra/dec', () => {
  assert.equal(targetViewerUrl({ name: "Barnard's Star", ra: 269.45, dec: 4.69, presetKey: 'barnard' }, 60902.86472),
    'index.html?q=Barnard%27s+Star&scene=viewer&mjd=60902.86472');
  assert.equal(new URLSearchParams(targetViewerUrl({ name: 'WISE 0855−0714', ra: 133.8, dec: -7.2, presetKey: 'wise-0855' }).split('?')[1]).get('q'), 'WISE 0855');
  assert.equal(targetViewerUrl({ name: 'RW Aurigae', ra: 76.96, dec: 30.4 }, 60919.4), 'index.html?q=RW+Aurigae&scene=viewer&mjd=60919.40000');
  assert.equal(targetViewerUrl({ name: null, ra: 10.6847, dec: 41.269 }, 60865.5), 'index.html?ra=10.68470&dec=41.26900&scene=viewer&mjd=60865.50000');
  assert.equal(targetViewerUrl({ name: 'Vega', ra: 279.23, dec: 38.78 }), 'index.html?ra=279.23000&dec=38.78000&scene=viewer');
});
