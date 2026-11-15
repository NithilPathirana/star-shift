// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// QA Sun 15 Nov (item 4): the viewer's "Where to look" box and the planetarium's "Can I see it
// tonight?" card disagreed (different darkness rule, step, threshold, clock). Both now take their
// numbers from ONE function (sky.js skyTonight) and their words from tonightWords. This checks
// that both pages' code paths give identical numbers for the five targets from Colombo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { skyTonight, tonightWords, visibleTonight, altAz } from '../web/app/sky.js';
import { starAnswer } from '../web/app/planet/tonight.js';
import { PRESETS } from '../web/app/presets.js';
import { propagate } from '../web/core/motion.js';

const COLOMBO = { lat: 6.927, lon: 79.861 };
const NOW_MJD = 61360; // the moment both pages put the moving stars (ui.js NOW_MJD, planet/main.js)
const fmt = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const at = (d) => fmt(d); // both pages: 24-hour HH:MM (+ a day word, left out here)
const pos = (key) => propagate(PRESETS.find(p => p.key === key).target, NOW_MJD);
const MORNING = new Date('2026-11-15T03:00:00Z'); // 08:30 in Colombo
const LATE = new Date('2026-11-14T17:30:00Z');    // 23:00 in Colombo

// The viewer's path: ui.js whereToLook -> skyTonight + tonightWords (it cannot run in node: DOM)
function viewerPath(ra, dec, now) { const st = skyTonight(ra, dec, COLOMBO.lat, COLOMBO.lon, now); return { st, w: tonightWords(st, dec, COLOMBO.lat, at) }; }
// The planetarium's path: planet/main.js renderAnswer/renderSel -> starAnswer
function planetPath(ra, dec, now) { return starAnswer({ ra, dec, ...COLOMBO, date: now, place: 'Colombo', at }); }

test("Barnard's Star from Colombo: same best time, altitude, rise/transit/set on both pages", () => {
  const { ra, dec } = pos('barnard');
  const v = viewerPath(ra, dec, MORNING), p = planetPath(ra, dec, MORNING);
  assert.deepEqual(p.st, v.st); // identical numbers, not just similar
  assert.equal(v.w.kind, 'yes'); assert.equal(p.verdict, 'yes');
  assert.match(v.w.bestText, /^best tonight at 18:3\d, 29° up in the west$/);
  assert.equal(p.head, `Yes, from Colombo: ${v.w.bestText}`);
  assert.match(v.w.dayText, /^Rose 08:2\d, highest 14:3\d at 88°, almost straight overhead, sets 20:3\d\.$/);
  assert.ok(p.detail.includes(v.w.dayText) && p.detail.includes(v.w.darkText));
  // best = highest while the Sun is below -12°, and it really is that high then
  assert.ok(Math.abs(altAz(ra, dec, COLOMBO.lat, COLOMBO.lon, v.st.best.t).alt - v.st.best.alt) < 1e-9);
  // the Observer rows / details page (visibleTonight) agree too
  const vis = visibleTonight(ra, dec, COLOMBO.lat, COLOMBO.lon, MORNING);
  assert.equal(vis.bestTime.getTime(), v.st.best.t.getTime()); assert.equal(vis.bestAlt, v.st.best.alt);
});

test('all five targets, morning and late night: the two pages give the same numbers and words', () => {
  for (const k of PRESETS.map(p => p.key)) for (const now of [MORNING, LATE]) {
    const { ra, dec } = pos(k), v = viewerPath(ra, dec, now), p = planetPath(ra, dec, now);
    assert.deepEqual(p.st, v.st, k);
    assert.ok(p.head.endsWith(v.w.bestText), `${k}: ${p.head}`);
    assert.ok(p.detail.includes(v.w.dayText), k);
  }
});

test('R Draconis is low while it is dark: neither page says Yes (one 20° threshold)', () => {
  const { ra, dec } = pos('r-dra'), v = viewerPath(ra, dec, MORNING), p = planetPath(ra, dec, MORNING);
  assert.equal(v.w.kind, 'low'); assert.equal(p.verdict, 'low');
  assert.ok(v.st.best.alt < 20 && v.st.best.alt > 0);
  assert.match(p.head, /^Low tonight, from Colombo: at most \d+° up while it is dark tonight, at \d\d:\d\d \(under 20°\)$/);
});

test('late at night after Barnard has set: both say it set, with the same time', () => {
  const { ra, dec } = pos('barnard'), v = viewerPath(ra, dec, LATE), p = planetPath(ra, dec, LATE);
  assert.equal(v.w.kind, 'set'); assert.equal(p.verdict, 'set');
  assert.match(p.head, /^Not any more tonight, from Colombo: it set at 20:\d\d/);
});

test('both pages call the shared functions (source check: ui.js needs a DOM, so it is read, not run)', () => {
  const ui = readFileSync(new URL('../web/app/ui.js', import.meta.url), 'utf8');
  const look = ui.slice(ui.indexOf('function whereToLook('), ui.indexOf('function lookShort('));
  assert.match(look, /skyTonight\(ra, dec, lat, lon, now\)/); assert.match(look, /tonightWords\(st, dec, lat, at\)/);
  assert.doesNotMatch(look, /visibleTonight|riseTransitSet/); // no second computation
  assert.match(ui, /const hm = d => d\.toLocaleTimeString\(\[\], \{ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' \}\)/);
  const pl = readFileSync(new URL('../web/app/planet/main.js', import.meta.url), 'utf8');
  assert.match(pl, /starAnswer\(\{ ra: sel\.ra, dec: sel\.dec, lat: S\.place\.lat, lon: S\.place\.lon/);
  assert.match(pl, /starTonight\(sel, t\)\.st\.rts/); // the Rise and set panel uses the same numbers
  assert.match(pl, /propagate\(p\.target, 61360\)/);
});
