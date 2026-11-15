// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Tests for "Spot a mover" (DESIGN.md 34): web/app/spot/logic.js and checks.js, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../web/app/spot/logic.js';
import { runStarCheck, runAsteroidCheck } from '../web/app/spot/checks.js';
import { propagate, separationArcsec } from '../web/core/motion.js';
import { PRESETS } from '../web/app/presets.js';

const barnard = PRESETS.find(p => p.key === 'barnard').target;
const EP = [{ mjd: 60940, label: 'First season' }, { mjd: 61290, label: 'Latest season' }];

// ---------- fields
test('quick picks are the five NASA targets; surprise patches are distinct and pick another one', () => {
  assert.deepEqual(L.QUICK.map(f => f.key), ['barnard', 'eps-indi-b', 'wise-0855', 'rw-aur', 'r-dra']);
  assert.ok(L.SURPRISE.length >= 4 && L.SURPRISE.length <= 6);
  for (const f of L.SURPRISE) assert.ok(!f.label.includes(f.target.name), 'the label must not give the star away');
  assert.notEqual(L.pickSurprise('s-leo', () => 0.2).key, 's-leo');
  assert.equal(L.nearestField(269.45, 4.7).field.key, 'barnard');
});

// ---------- checklist state machine
test('checklist: all checks run at once; each line settles on its own; retry only a failed line', () => {
  let s = L.checklistStep(L.initChecklist(), { type: 'start' });
  assert.deepEqual(s.lines.map(l => l.status), ['checking', 'checking', 'checking', 'checking']);
  s = L.checklistStep(s, { type: 'done', id: 'star', status: 'clear' });
  s = L.checklistStep(s, { type: 'done', id: 'flags', status: 'clear', text: 'ok' });
  assert.deepEqual(s.lines.map(l => l.status), ['clear', 'clear', 'checking', 'checking']);
  assert.equal(L.checklistStep(s, { type: 'done', id: 'star', status: 'failed' }), s, 'a settled line is not overwritten');
  s = L.checklistStep(s, { type: 'done', id: 'seasons', status: 'clear' });
  assert.equal(L.decideVerdict(s).kind, 'pending', 'Unexplained waits for JPL');
  assert.deepEqual(L.decideVerdict(s).running, ['asteroid']);
  s = L.checklistStep(s, { type: 'done', id: 'asteroid', status: 'failed', text: 'no reply' });
  assert.ok(L.isFinished(s)); assert.equal(L.decideVerdict(s).kind, 'incomplete');
  s = L.checklistStep(s, { type: 'retry', id: 'asteroid' });
  assert.deepEqual(s.lines.map(l => l.status), ['clear', 'clear', 'checking', 'clear']);
  s = L.checklistStep(s, { type: 'done', id: 'asteroid', status: 'clear' });
  assert.equal(L.decideVerdict(s).kind, 'unexplained');
  assert.equal(L.checklistStep(s, { type: 'retry', id: 'flags' }), s, 'a clear line cannot be retried');
});

test('the verdict shows before JPL answers when the quick checks decide it, and an asteroid upgrades an artefact', () => {
  let s = L.checklistStep(L.initChecklist(), { type: 'start' });
  s = L.checklistStep(s, { type: 'done', id: 'flags', status: 'clear' });
  assert.equal(L.decideVerdict(s).kind, 'pending', 'the star check decides first');
  const star = L.checklistStep(s, { type: 'done', id: 'star', status: 'explained', data: { best: { name: 'X' }, mover: true } });
  const v = L.decideVerdict(star);
  assert.equal(v.kind, 'known-star'); assert.deepEqual(v.running, ['asteroid', 'seasons']);
  s = L.checklistStep(s, { type: 'done', id: 'star', status: 'clear' });
  s = L.checklistStep(s, { type: 'done', id: 'seasons', status: 'explained', text: 'only 1' });
  assert.equal(L.decideVerdict(s).kind, 'artefact'); assert.deepEqual(L.decideVerdict(s).running, ['asteroid']);
  s = L.checklistStep(s, { type: 'done', id: 'asteroid', status: 'explained', data: { hit: { name: '541093 (2018 RJ4)' } } });
  assert.equal(L.decideVerdict(s).kind, 'known-asteroid');
});

const finished = (st) => {
  let s = L.checklistStep(L.initChecklist(), { type: 'start' });
  for (const id of ['flags', 'star', 'asteroid', 'seasons']) s = L.checklistStep(s, { type: 'done', id, status: st[id], text: `${id} text`, data: st[`${id}Data`] });
  return s;
};

// ---------- verdict rule and wording
test('verdicts follow the spec wording', () => {
  const star = L.decideVerdict(finished({ flags: 'clear', star: 'explained', starData: { best: { name: "Barnard's Star" }, mover: true }, asteroid: 'clear', seasons: 'clear' }));
  assert.equal(star.kind, 'known-star'); assert.equal(star.title, 'Known star'); assert.equal(star.sub, 'moving as expected');
  assert.equal(star.body.join(' '), "This is Barnard's Star, a star known to move this much. You found it by eye: that is exactly how it is done.");
  const art = L.decideVerdict(finished({ flags: 'explained', star: 'clear', asteroid: 'clear', seasons: 'clear' }));
  assert.equal(art.title, 'Likely artefact'); assert.equal(art.body.join(' '), 'This is most likely not a real object. Here is why.');
  assert.equal(L.decideVerdict(finished({ flags: 'clear', star: 'clear', asteroid: 'clear', seasons: 'explained' })).kind, 'artefact', 'one season only = artefact');
  const ast = L.decideVerdict(finished({ flags: 'clear', star: 'clear', asteroid: 'explained', asteroidData: { hit: { name: '541093 (2018 RJ4)' } }, seasons: 'explained' }));
  assert.equal(ast.title, 'Known asteroid'); assert.equal(ast.body[0], 'This is 541093 (2018 RJ4), a known asteroid, passing through.');
  const un = L.decideVerdict(finished({ flags: 'clear', star: 'clear', asteroid: 'clear', seasons: 'clear' }));
  assert.equal(un.title, 'Unexplained: worth reporting');
  assert.equal(un.body.join(' '), 'None of our checks explains this. That does not make it a discovery, but it is worth a second look by people who do this for a living.');
});

test('no verdict when a check could not run and nothing explains it; an explanation still stands', () => {
  const v = L.decideVerdict(finished({ flags: 'clear', star: 'clear', asteroid: 'failed', seasons: 'clear' }));
  assert.equal(v.kind, 'incomplete'); assert.equal(v.title, 'We could not finish checking'); assert.deepEqual(v.retry, ['asteroid']);
  assert.match(v.body[0], /Not a known asteroid/);
  const s = L.decideVerdict(finished({ flags: 'clear', star: 'explained', starData: { best: { name: 'X' }, mover: true }, asteroid: 'failed', seasons: 'clear' }));
  assert.equal(s.kind, 'known-star'); assert.match(s.notRun, /could not run/);
  assert.equal(L.decideVerdict(finished({ flags: 'clear', star: 'failed', asteroid: 'failed', seasons: 'clear' })).kind, 'incomplete');
});

// ---------- check a: flags
const NAMES = { 1: { name: 'TRANSIENT' }, 2: { name: 'OVERFLOW' }, 4: { name: 'SUR_ERROR' }, 2097152: { name: 'SOURCE' }, 4194304: { name: 'GHOST' }, 67108864: { name: 'BLOOM' }, 131072: { name: 'PERSIST' } };
const frame = (set = {}) => { const n = 9, flags = new Int32Array(n * n); for (const [k, w] of Object.entries(set)) flags[+k] = w; return { n, flags, flagNames: NAMES }; };
test('flags: a pixel flagged in a third of a season explains it; a bright star\'s own flags do not', () => {
  const at = 4 * 9 + 4;
  const ghostSeason = [...Array(6)].map((_, i) => frame(i < 3 ? { [at]: 4194304 } : {}));
  const r = L.evaluateFlags([{ label: 'First season', frames: ghostSeason }, { label: 'Latest season', frames: [frame(), frame()] }], 4, 4);
  assert.equal(r.status, 'explained'); assert.match(r.text, /3 of 6 images of the first season \(Scattered light 3\)/);
  // a single cosmic-ray hit: clear, and says why
  const one = L.evaluateFlags([{ label: 'First season', frames: [frame({ [at + 1]: 1 }), frame(), frame(), frame()] }], 4, 4);
  assert.equal(one.status, 'clear'); assert.match(one.text, /Only 1 of 4 images/);
  // saturated star core: OVERFLOW+TRANSIENT on the same pixel is the star, not an artefact
  const star = L.evaluateFlags([{ label: 'First season', frames: [...Array(4)].map(() => frame({ [at]: 2 | 1 | 2097152 })) }], 4, 4);
  assert.equal(star.status, 'clear'); assert.match(star.text, /saturated \(pixel overflow\) in 4 of 4 images of the first season: that is the star itself/);
  assert.equal(L.evaluateFlags([{ label: 'First season', frames: [frame()] }], 4, 4).text, 'No archive flags on or next to this spot.');
  // two pixels away is not "on or next to"
  assert.equal(L.flagsAtSpot(frame({ [4 * 9 + 6]: 1 }), 4, 4).kinds.size, 0);
});

test('flags: saturation is counted on its own line, apart from the fault flags (judging panel a11)', () => {
  const at = 4 * 9 + 4;
  // Barnard-like: centre saturated in every image, a real ghost flag in 4 of 40
  const season = [...Array(40)].map((_, i) => frame({ [at]: 2 | 1, ...(i < 4 ? { [at + 9]: 4194304 } : {}) }));
  const latest = [...Array(40)].map((_, i) => frame(i < 30 ? { [at]: 67108864 } : {}));
  const r = L.evaluateFlags([{ label: 'First season', frames: season }, { label: 'Latest season', frames: latest }], 4, 4);
  assert.equal(r.status, 'clear'); // decision unchanged: 4 of 40 is under a third
  assert.match(r.text, /^Only 4 of 40 images of the first season carry a fault flag here/);
  assert.equal(r.per[0].saturated, 40); assert.equal(r.per[1].saturated, 30); assert.equal(r.per[0].flagged, 4);
  assert.match(r.text, /The centre is saturated \(pixel overflow\) in 40 of 40 images of the first season and 30 of 40 images of the latest season: that is the star itself, not a fault, so it is not counted as a flag\./);
  assert.equal(L.saturationText([{ label: 'First season', n: 10, saturated: 0 }]), '');
  assert.match(L.saturationText([{ label: 'First season', n: 10, saturated: 2 }]), /2 of 10 images of the first season: a bright star filling those pixels/);
});

// ---------- check b: known stars
test('Barnard\'s Star clicked at its moved position is explained as a known mover', () => {
  const at = propagate(barnard, EP[1].mjd); // where it is in the latest season
  const gaia = { ok: true, stars: [{ name: 'Gaia DR3 4472832130942575872', ...propagate(barnard, 57388.5), pmra: barnard.pmra, pmdec: barnard.pmdec, epoch: 2016, source: 'Gaia DR3', g: 8.2 },
    { name: 'Gaia DR3 1', ra: at.ra + 0.01, dec: at.dec, pmra: 0, pmdec: 0, epoch: 2016, source: 'Gaia DR3' }] };
  const simbad = { ok: true, stars: L.simbadStars([
    { main_id: "NAME Barnard's Star", ra: barnard.ra, dec: barnard.dec, pmra: barnard.pmra, pmdec: barnard.pmdec, otype: 'BY*' },
    { main_id: "NAME Barnard's Star b", ra: barnard.ra, dec: barnard.dec, pmra: barnard.pmra, pmdec: barnard.pmdec, otype: 'Pl' },
    { main_id: 'GES J17574778+0443542', ra: at.ra + 1 / 3600, dec: at.dec, pmra: '', pmdec: '', otype: '*' }]) };
  assert.equal(simbad.stars.length, 2, 'planets are dropped');
  const r = L.decideStar({ gaia, simbad }, at, EP);
  assert.equal(r.status, 'explained'); assert.equal(r.best.name, "Barnard's Star", 'a moving SIMBAD star wins over a static old-survey entry');
  assert.ok(r.mover); assert.ok(r.best.shift > 9, `moves ${r.best.shift}″ between seasons`);
  assert.match(r.text, /moves 10\.39″ a year/);
  // the first-season position is not where the ring is
  assert.ok(r.best.seps[0] > 9.2 && r.best.seps[1] < 1);
});
test('star check: clear only when both catalogues answered', () => {
  const at = { ra: 10, dec: 10 };
  assert.equal(L.decideStar({ gaia: { ok: true, stars: [] }, simbad: { ok: true, stars: [] } }, at, EP).status, 'clear');
  const f = L.decideStar({ gaia: { ok: false }, simbad: { ok: true, stars: [] } }, at, EP);
  assert.equal(f.status, 'failed'); assert.match(f.text, /Gaia did not answer/);
  assert.equal(L.gaiaStars([{ id: 'a', ra: 1, dec: 1, g: 20.5 }, { id: 'b', ra: 1, dec: 1, g: 12 }]).length, 1, 'too faint for SPHEREx');
  assert.match(L.simbadConeADQL(269.45, 4.7), /^SELECT TOP 400 main_id, ra, dec, pmra, pmdec, otype FROM basic WHERE CONTAINS\(POINT\('ICRS', ra, dec\), CIRCLE\('ICRS', 269\.450000, 4\.700000, 0\.083333\)\) = 1$/);
});

// ---------- check c: JPL sb_ident
test('sb_ident request: only names the relay allows, the image\'s real UTC time, both kinds', () => {
  const p = L.sbIdentParams({ ra: 269.4486, dec: -4.7397, utc: '2025-08-15T20:46:08.896', halfWidthDeg: 0.03 });
  for (const k of p.keys()) assert.ok(L.SB_IDENT_ALLOWED.includes(k), k);
  assert.equal(p.get('obs-time'), '2025-08-15_20:46:08');
  assert.equal(p.get('fov-ra-center'), '17-57-47.66'); assert.equal(p.get('fov-dec-center'), 'M04-44-22.92');
  assert.equal(p.get('fov-ra-hwidth'), '0.03'); assert.equal(L.sbIdentParams({ ra: 1, dec: 1, utc: '2025-08-15T00:00:00', halfWidthDeg: L.FIELD_HALF_WIDTH_DEG }).get('fov-dec-hwidth'), '0.035'); assert.equal(p.get('mpc-code'), '500'); assert.equal(p.has('sb-kind'), false);
  const g = L.sbIdentParams({ ra: 269.4486, dec: 4.7397, utc: '2025-08-15T20:46:08', observer: 'geocentric-state' });
  assert.equal(g.get('xobs'), '0,0,0,0,0,0'); assert.equal(g.has('mpc-code'), false);
  assert.ok(L.sbIdentPath({ ra: 1, dec: 1, utc: '2026-01-01T00:00:00' }).startsWith('/jpl/sb_ident?'));
  assert.throws(() => L.utcToJplTime('yesterday'));
});
const SB = { signature: { version: '1.1' }, fields_second: ['Object name', 'Astrometric RA (hh:mm:ss)', "Astrometric Dec (dd mm'ss\")", 'Dist. from center RA (")', 'Dist. from center Dec (")', 'Dist. from center Norm (")', 'Visual magnitude (V)', 'RA rate ("/h)', 'Dec rate ("/h)'],
  data_second_pass: [['541093 (2018 RJ4)', '17:57:46.10', "+04 45'54.2\"", '-14.4', '-20.3', '84.9', '19.4', '1', '2'], ['2P/Encke', '17:57:48.02', "-04 46'31.8\"", '9', '8', '12.0', null, '1', '1']] };
test('sb_ident answers parse; objects match the ring locally within 12″, along an hour of track', () => {
  const rows = L.parseSbIdent(SB);
  assert.equal(rows[0].name, '2P/Encke'); assert.equal(rows[0].dist, 12); assert.ok(rows[0].dec < 0); assert.equal(rows[0].vmag, null);
  assert.ok(Math.abs(rows[1].ra - 269.44208) < 1e-4); assert.equal(rows[1].raRate, 1); assert.equal(rows[1].decRate, 2);
  const enc = rows[0], near = { ra: enc.ra + 8 / 3600 / Math.cos(enc.dec * Math.PI / 180), dec: enc.dec }; // 8″ east of Encke
  const v = L.decideAsteroid([{ label: 'First season', mjd: 60900, utc: '2025-08-15T20:46:08', ok: true, rows }], near);
  assert.equal(v.status, 'explained'); assert.equal(v.hit.name, '2P/Encke'); assert.ok(L.isComet('2P/Encke'));
  const far = { ra: near.ra + 10 / 3600, dec: near.dec };
  assert.equal(L.decideAsteroid([{ ok: true, rows }], far).status, 'clear', '~18″ away is not a match');
  // a fast object: 30″ north of the ring now, moving 40″/h south, passes over the ring within the hour
  const fast = { name: '1 Fast', ra: 100, dec: 10 + 30 / 3600, raRate: 0, decRate: -40, err: 0 };
  assert.ok(L.passDistance(fast, { ra: 100, dec: 10 }) < 0.01);
  assert.equal(L.passDistance({ ...fast, decRate: -10 }, { ra: 100, dec: 10 }).toFixed(1), '20.0', 'capped at one hour of track');
  const nf = L.decideAsteroid([{ ok: false, status: 404 }, { ok: true, rows: [] }], far);
  assert.equal(nf.status, 'failed'); assert.match(nf.text, /HTTP 404/);
});
const res = (status, body) => ({ ok: status === 200, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), body: null });
test('a known object near the ring explains it only if SPHEREx could see it (V ≤ 18.5)', () => {
  const at = { ra: 76.97375, dec: 30.40636 }; // RW Aurigae field, the asteroid's predicted place
  const row = (vmag) => ({ name: '(2017 XW81)', ra: at.ra + 9.6 / 3600 / Math.cos(at.dec * Math.PI / 180), dec: at.dec, dist: 56, vmag, err: null, raRate: 0, decRate: 0 });
  const season = { label: 'Latest season', mjd: 61294.877, utc: '2026-09-11T21:02:28', ok: true };
  const faint = L.decideAsteroid([{ ...season, rows: [row(22.3)] }], at);
  assert.equal(faint.status, 'clear');
  assert.equal(faint.text, "JPL predicts asteroid 2017 XW81 (V ≈ 22.3) 9.6″ from here on 11 Sep 2026. It is far too faint for SPHEREx to see, so it doesn't explain this dot.");
  const bright = L.decideAsteroid([{ ...season, rows: [row(17.2)] }], at);
  assert.equal(bright.status, 'explained');
  assert.equal(bright.text, 'JPL predicts asteroid 2017 XW81 (V ≈ 17.2) 9.6″ from here on 11 Sep 2026. It could be visible to SPHEREx, so it may explain this dot.');
  assert.equal(L.decideAsteroid([{ ...season, rows: [row(19.6)] }], at).text.includes('It is too faint'), true, 'just past the limit: "too faint", not "far too faint"');
  assert.equal(L.decideAsteroid([{ ...season, rows: [row(null)] }], at).status, 'explained', 'no magnitude from JPL: cannot be ruled out');
  assert.equal(L.SPHEREX_VISIBLE_V, 18.5);
  for (const t of [faint.text, bright.text]) assert.doesNotMatch(t, /\b(found|caught|detected|saw)\b/i);
  // the verdict for a faint object near a known star stays Known star
  let s = L.checklistStep(L.initChecklist(), { type: 'start' });
  for (const [id, status, data] of [['flags', 'clear'], ['star', 'explained', { best: { name: 'RW Aur' }, mover: false }], ['asteroid', faint.status, faint], ['seasons', 'clear']]) s = L.checklistStep(s, { type: 'done', id, status, text: '', data });
  assert.equal(L.decideVerdict(s).kind, 'known-star'); assert.equal(L.decideVerdict(s).title, 'Known still star', 'a star that does not move is named as still (A4)');
});
test('field-level lookups: one JPL request per season for the whole patch serves every click', async () => {
  const { fetchFieldAsteroids, asteroidCheckAt } = await import('../web/app/spot/checks.js');
  const seen = [];
  const results = await fetchFieldAsteroids({ centre: { ra: 269.446, dec: 4.77 }, base: '', fetchFn: async (u) => { seen.push(u); return res(200, SB); },
    seasons: [{ label: 'First season', mjd: 1, utc: '2025-08-15T20:46:08' }, { label: 'Latest season', mjd: 2, utc: '2026-08-23T23:02:00' }] });
  assert.equal(seen.length, 2); assert.match(seen[0], /fov-ra-center=17-57-47\.04&fov-dec-center=04-46-12\.00&fov-ra-hwidth=0\.035/);
  const rows = results[0].rows, onIt = { ra: rows[1].ra, dec: rows[1].dec };
  assert.equal(asteroidCheckAt(results, onIt).status, 'clear', 'V 19.4 is too faint for SPHEREx');
  assert.equal(asteroidCheckAt(results, { ra: 269.43, dec: 4.75 }).status, 'clear');
  assert.equal(seen.length, 2, 'no new requests per click');
  assert.deepEqual(L.fieldCentre({ ra0: 269.44612345678, dec0: 4.7701234567 }), { ra: 269.446123, dec: 4.770123 });
});
test('asteroid check: MPC 500 refused -> retried with the geocentric state; 404 -> could not check', async () => {
  const seen = [];
  const fetchFn = async (url) => { seen.push(url); return url.includes('mpc-code=500') ? res(400, { message: 'bad' }) : res(200, SB); };
  const r = await runAsteroidCheck({ at: { ra: 269.44208, dec: 4.76506 }, base: 'http://x', fetchFn,
    seasons: [{ label: 'First season', mjd: 60902.86, utc: '2025-08-15T20:46:08.896' }] });
  assert.equal(seen.length, 2); assert.match(seen[0], /^http:\/\/x\/jpl\/sb_ident\?obs-time=2025-08-15_20%3A46%3A08&/); assert.match(seen[1], /xobs=0%2C0/);
  assert.equal(r.status, 'clear'); assert.match(r.text, /^JPL predicts asteroid 541093 \(2018 RJ4\) \(V ≈ 19\.4\) /);
  const r404 = await runAsteroidCheck({ at: { ra: 1, dec: 1 }, base: '', fetchFn: async () => res(404, 'Not found'), seasons: [{ label: 'A', mjd: 1, utc: '2025-08-15T00:00:00' }] });
  assert.equal(r404.status, 'failed');
  const slow = await runAsteroidCheck({ at: { ra: 1, dec: 1 }, base: '', timeoutMs: 20, seasons: [{ label: 'A', mjd: 1, utc: '2025-08-15T00:00:00' }],
    fetchFn: (u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason))) });
  assert.equal(slow.status, 'failed'); assert.match(slow.text, /no reply/);
});
test('star check through canned Gaia and SIMBAD answers', async () => {
  const fetchFn = async (url) => (url.includes('/gaia/') ? res(200, 'source_id,ra,dec,pmra,pmdec,parallax,phot_g_mean_mag\n1,10,10,0,0,1,12\n') : res(200, 'main_id,ra,dec,pmra,pmdec,otype\n"* foo",10,10,,,"*"\n'));
  const r = await runStarCheck({ at: { ra: 10, dec: 10 }, epochs: EP, base: '', fetchFn });
  assert.equal(r.status, 'explained'); assert.equal(r.mover, false); assert.match(r.text, /stays put/);
  const down = await runStarCheck({ at: { ra: 10, dec: 10 }, epochs: EP, base: '', fetchFn: async () => res(503, '') });
  assert.equal(down.status, 'failed'); assert.match(down.text, /Gaia and SIMBAD did not answer/);
});

// ---------- check d: seasons
test('a dot is found near the ring; seasons present decide the check', () => {
  const n = 25, mk = (dot) => { const data = new Float32Array(n * n).map((_, i) => 1 + ((i * 7919) % 13) / 100); if (dot) for (const [dx, dy, v] of [[0, 0, 40], [1, 0, 12], [-1, 0, 12], [0, 1, 12], [0, -1, 12]]) data[(dot[1] + dy) * n + dot[0] + dx] += v; return { n, data, label: 'S' }; };
  assert.ok(L.detectNear(mk([12, 12]), 12.4, 11.6));
  assert.equal(L.detectNear(mk(null), 12, 12), null);
  assert.equal(L.detectNear(mk([18, 12]), 12, 12), null, 'too far from the ring');
  const pres = L.seasonPresence([mk([12, 12]), mk(null), mk([12, 12])], () => [[12, 12]]);
  assert.equal(L.decideSeasons(pres).text, 'Present in 2 of 3 seasons.');
  const one = L.decideSeasons(L.seasonPresence([mk([12, 12]), mk(null)], () => [[12, 12]]));
  assert.equal(one.status, 'explained'); assert.match(one.text, /only 1 of 2 seasons/);
});

test('the glow beside a bright star is not a dot (E2E Sun 15 Nov: RW Aur / R Dra halo read as present in 3 of 3)', () => {
  const n = 25, glow = (dot) => { const data = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
    data[j * n + i] = 1 + ((j * n + i) * 7919 % 13) / 100 + 3000 * Math.exp(-((i - 12) ** 2 + (j - 12) ** 2) / (2 * 2.5 ** 2)) + 200 / (1 + ((i - 12) ** 2 + (j - 12) ** 2) / 4);
    data[12 * n + 12] = NaN; // saturated, masked core
    if (dot) for (const [dx, dy, v] of [[0, 0, 400], [1, 0, 120], [-1, 0, 120], [0, 1, 120], [0, -1, 120]]) data[(dot[1] + dy) * n + dot[0] + dx] += v;
    return { n, data, label: 'S' }; };
  assert.equal(L.detectNear(glow(null), 12, 9), null, 'the wing of the star is not a dot');
  // 3 px (18″) from a saturated star: within the PSF wings, so it is the star's glow
  const d = L.decideSeasons(L.seasonPresence([glow(null), glow(null), glow(null)], () => [[12, 9]]));
  assert.equal(d.status, 'explained'); assert.equal(d.glow, true); assert.match(d.text, /glow of a brighter source about 18″ away/);
  // 7 px away the walk would have to go further than the wings: not called glow (Full function test: 80″ "glows")
  const far = L.decideSeasons(L.seasonPresence([glow(null), glow(null), glow(null)], () => [[12, 5]]));
  assert.equal(far.glow, false);
  assert.ok(L.detectNear(glow([4, 12]), 4, 12), 'a real compact dot on the far glow is still found');
  const v = L.decideVerdict({ lines: [{ id: 'flags', status: 'clear', text: '', data: { per: [] } }, { id: 'star', status: 'clear', text: '' },
    { id: 'asteroid', status: 'clear', text: '' }, { id: 'seasons', status: 'explained', text: d.text, data: d }] });
  assert.equal(v.title, 'Not a separate dot'); assert.notEqual(v.kind, 'unexplained');
});

test('empty sky gets "Nothing here", not a glow from a star far away (Full function test, Sun 15 Nov)', () => {
  const n = 25, sky = () => { const data = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
    data[j * n + i] = 10 + ((j * n + i) * 7919 % 13) / 10 + 5000 * Math.exp(-((i - 3) ** 2 + (j - 3) ** 2) / (2 * 1.2 ** 2));
    return { n, data, label: 'S' }; };
  const d = L.decideSeasons(L.seasonPresence([sky(), sky(), sky()], () => [[18, 18]]));
  assert.equal(d.glow, false); assert.equal(d.nothing, true); assert.match(d.text, /No dot stands out from the noise/);
  const v = L.decideVerdict({ lines: [{ id: 'flags', status: 'clear', text: '', data: { per: [] } }, { id: 'star', status: 'clear', text: '' },
    { id: 'asteroid', status: 'clear', text: '' }, { id: 'seasons', status: 'explained', text: d.text, data: d }] });
  assert.equal(v.kind, 'nothing'); assert.equal(v.title, 'Nothing here');
});

// ---------- summary and words
test('the report summary holds the sky facts and nothing about the user', () => {
  const s = finished({ flags: 'clear', star: 'clear', asteroid: 'clear', seasons: 'clear' });
  const txt = L.summaryText({ fieldLabel: 'A patch in Leo', centre: { ra: 164.1, dec: 7 }, suspect: { n: 2, ra: 164.101, dec: 7.001 },
    seasons: [{ label: 'First season', startDate: new Date('2025-04-28'), endDate: new Date('2025-06-07'), mjd: 60810.5, count: 48, wl: [0.75, 4.98], obsids: ['2025W18_1A_0001_1'], found: { ra: 164.101, dec: 7.001 } }],
    lines: s.lines, verdict: L.decideVerdict(s) });
  for (const want of ['Field centre (J2000): 10h 56m 24.00s +07° 00′ 00.0″', 'Suspect ring', '28 Apr 2025 – 7 Jun 2025', '0.75–4.98 µm', '2025W18_1A_0001_1', 'Not a known asteroid: Clear.',
    'Verdict: Unexplained: worth reporting', 'Made with Star Shift from NASA SPHEREx data via IRSA', '10.26131/IRSA678', '10.26131/IRSA662']) assert.ok(txt.includes(want), want);
  assert.doesNotMatch(txt, /user|name:|email|location/i);
});
test('banned words and things never appear on the page', () => {
  const src = ['../web/spot.html', '../web/app/spot/main.js', '../web/app/spot/logic.js', '../web/app/spot/checks.js', '../web/styles/spot.css']
    .map(f => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, /\b(discovered|new planet|you found a new object|confetti|badges?|leaderboards?|day streak|points)\b/i); // "Streak" alone is an archive flag kind
  const html = readFileSync(new URL('../web/spot.html', import.meta.url), 'utf8');
  assert.match(html, /<span class="ai-mark rail-ai"/); assert.match(html, /<span class="ai-mark top-ai"/);
  assert.match(html, /Logo: SI-generated with ChatGPT; small version and favicon redrawn as SVG by Claude\./);
  assert.match(html, /class="nav-btn nav-demote" href="planetarium.html" title="Can I see it tonight\?"/);
  assert.match(html, /href="spot.html" aria-current="page"/);
  assert.doesNotMatch(html, /<img[^>]+(nasa|spherex)[^>]*>/i, 'no agency logos');
  for (const l of L.REPORT_LINKS) assert.match(l.href, /^https:\/\//);
});

// ---------- judging panel A4: the nearest source, not the first mover within 9.2″ (WISE 0855 decoy)
// Real rows from the WISE 0855 field (Gaia DR3 + SIMBAD prebaked answers, 15 Nov 2026) and the real
// season middles: all detectors 60801.22 / 61161.96, detectors 5–6 60801.19 / 61158.27.
const WISE = { name: 'WISEA J085510.74-071442.5', ra: 133.81890825, dec: -7.247048, pmra: -8123.7, pmdec: 673.2, epoch: 2000, source: 'SIMBAD', otype: 'BD*' };
const G163 = { name: 'Gaia DR3 5756956644387831296', ra: 133.75818250493919, dec: -7.241155906974705, pmra: -6.187834849360848, pmdec: 1.9308548733514355, epoch: 2016, source: 'Gaia DR3', g: 16.314917 };
const W_CAT = { gaia: { ok: true, stars: [G163] }, simbad: { ok: true, stars: [WISE] } };
const EP_ALL = [{ mjd: 60801.22, label: 'First season' }, { mjd: 61161.96, label: 'Latest season' }];
const EP_56 = [{ mjd: 60801.19, label: 'First season' }, { mjd: 61158.27, label: 'Latest season' }];
const verdictFor = (star) => L.decideVerdict(finished({ flags: 'clear', star: star.status, starData: star, asteroid: 'clear', seasons: 'clear' }));

test('A4: the G 16.3 dot beside WISE 0855 is a known still star, not the brown dwarf predicted 4.6″ away', () => {
  const g = propagate(G163, EP_ALL[1].mjd), w = propagate(WISE, EP_ALL[1].mjd);
  const dot = { ra: g.ra, dec: g.dec, k: 1 }; // the dot's measured centre in the latest all-detector stack sits on the Gaia star
  const old = L.matchCatalogue([G163, WISE], g, EP_ALL);
  assert.ok(old.find(m => m.name === WISE.name).minSep < L.STAR_MATCH_ARCSEC, 'the brown dwarf is inside 9.2″, so the old first-mover rule named it');
  const r = L.decideStar(W_CAT, g, EP_ALL, dot);
  assert.equal(r.status, 'explained'); assert.equal(r.best.name, G163.name); assert.equal(r.mover, false);
  assert.equal(r.rival.name, WISE.name);
  assert.match(r.text, /^Gaia DR3 5756956644387831296, G 16\.3 is catalogued 0(\.0)?″ from the centre of the dot you clicked/);
  assert.match(r.text, /WISEA J085510\.74-071442\.5, a brown dwarf that moves 8\.15″ a year, is predicted 4\.\d″ from the centre of the dot you clicked: further away/);
  const v = verdictFor(r);
  assert.equal(v.kind, 'known-star'); assert.equal(v.title, 'Known still star'); assert.equal(v.sub, 'Gaia DR3 5756956644387831296, G 16.3');
  assert.match(L.plainCheckText('star', r), /^Gaia DR3 5756956644387831296, G 16\.3, a catalogued star, sits right here/);
  // no dot measured: the ring is the reference, and it is on the Gaia star too
  assert.equal(L.decideStar(W_CAT, g, EP_ALL).best.name, G163.name);
  const sep = separationArcsec(g.ra, g.dec, w.ra, w.dec);
  assert.ok(sep > 4 && sep < 5, `brown dwarf ${sep}″ from the Gaia star in the latest season`);
});

test('A4: clicking the brown dwarf in the 3.8–5.0 µm stack names it as a moving brown dwarf', () => {
  const w = propagate(WISE, EP_56[1].mjd), g = propagate(G163, EP_56[1].mjd);
  const r = L.decideStar(W_CAT, w, EP_56, { ra: w.ra, dec: w.dec, k: 1 });
  assert.equal(r.best.name, WISE.name); assert.ok(r.mover); assert.equal(r.word, 'brown dwarf');
  const v = verdictFor(r);
  assert.equal(v.title, 'Known brown dwarf'); assert.equal(v.sub, 'moving as expected');
  assert.equal(v.body[0], 'This is WISEA J085510.74-071442.5, a brown dwarf known to move this much.');
  assert.match(L.plainCheckText('star', r), /a catalogued brown dwarf that moves/);
  // the real latest 5–6 dot is a blend, centred 2.2″ from the brown dwarf and 2.5″ from the Gaia star:
  // within the 1.5″ tie the mover is named
  const f = 0.47, blend = { ra: w.ra + f * (g.ra - w.ra), dec: w.dec + f * (g.dec - w.dec), k: 1 };
  assert.equal(L.decideStar(W_CAT, w, EP_56, blend).best.name, WISE.name);
  // first season (4 images on 5–6): the two are 11.8″ apart; a click on the Gaia star's place with no dot under it
  const g0 = propagate(G163, EP_56[0].mjd);
  assert.equal(L.decideStar(W_CAT, g0, EP_56).best.name, G163.name);
});

test('A4: pickStar takes the nearest entry; a mover wins only a tie within 1.5″', () => {
  const m = (name, ref, pm, shift, source = 'Gaia DR3') => ({ name, ref, minSep: ref, pm, shift, source });
  assert.equal(L.pickStar([m('still', 0.3, 0.005, 0.01), m('mover', 1.0, 8, 8)]).name, 'mover', 'inside the tie');
  assert.equal(L.pickStar([m('still', 0.3, 0.005, 0.01), m('mover', 2.0, 8, 8)]).name, 'still', 'outside the tie');
  assert.equal(L.pickStar([m('old survey copy', 0.2, 0, 0, 'SIMBAD'), m('mover', 1.2, 10, 10, 'SIMBAD')]).name, 'mover');
  assert.equal(L.pickStar([m('far', 9.5, 8, 8)]), null, 'nothing lands within 9.2″ of the ring');
  assert.equal(L.STAR_TIE_ARCSEC, 1.5);
  assert.equal(L.objectWord({ otype: 'BD*' }), 'brown dwarf'); assert.equal(L.objectWord({ otype: '*' }), 'star');
  assert.equal(L.objectWord({ note: 'Coldest known brown dwarf' }), 'brown dwarf'); assert.equal(L.objectWord({ otype: 'WD*' }), 'white dwarf');
  assert.equal(L.objectWord({ source: 'Gaia DR3' }), 'star');
});

test('A4: dotAt measures the dot nearest the click, not the brightest one nearby', () => {
  const n = 25, data = new Float32Array(n * n).map((_, i) => 1 + ((i * 7919) % 13) / 100);
  const add = (x, y, v) => { for (const [dx, dy, f] of [[0, 0, 1], [1, 0, 0.3], [-1, 0, 0.3], [0, 1, 0.3], [0, -1, 0.3]]) data[(y + dy) * n + x + dx] += v * f; };
  add(9, 12, 60); add(13, 12, 15); // a bright star and a fainter one 4 pixels east
  const st = { n, data };
  const d = L.dotAt(st, 12.8, 12.1);
  assert.ok(d && Math.abs(d.x - 13) < 0.3 && Math.abs(d.y - 12) < 0.3, `nearest dot: ${JSON.stringify(d)}`);
  assert.equal(L.dotAt(st, 18, 18), null, 'empty sky');
  assert.ok(Math.abs(L.dotAt(st, 9.2, 11.8).x - 9) < 0.3);
  assert.equal(L.detectNear(st, 11.4, 12), null, 'detectNear lands on the bright neighbour\'s wing there');
  assert.equal(Math.round(L.dotAt(st, 11.4, 12).x), 13, 'dotAt still finds the faint dot 1.6 pixels away');
});

test('A4: WISE 0855 is blinked on detectors 5–6 only, and the header says so', () => {
  const b = L.fieldBand(L.fieldByKey('wise-0855'));
  assert.deepEqual(b.dets, [5, 6]); assert.equal(b.text, 'Showing 3.8–5.0 µm: WISE 0855 is invisible at shorter wavelengths');
  assert.equal(L.fieldBand(L.fieldByKey('barnard')), null); assert.equal(L.fieldBand(L.fieldByKey('s-leo')), null);
  const seasonsOf = (fs) => [...new Set(fs.map(f => Math.floor(f.mjd / 300)))];
  const frames = [1, 3, 5, 6].flatMap(d => [{ detector: d, mjd: 60800 }, { detector: d, mjd: 61160 }]);
  const use = L.framesForField(frames, b, seasonsOf);
  assert.ok(use.frames.every(f => f.detector === 5 || f.detector === 6) && use.frames.length === 4 && use.band === b);
  const one = L.framesForField(frames.filter(f => f.mjd < 61000 || f.detector < 5), b, seasonsOf);
  assert.equal(one.band, null, 'fewer than two seasons on 5–6: keep every detector');
  assert.equal(L.framesForField(frames, null, seasonsOf).frames, frames);
});

// ---------- Master's rule (Full Function Test: RW Aur false "worth reporting"): a click on a catalogued
// star's own edge, 2 px (12″) from it, is that star, never "Unexplained"
test('a ring 2 px from a catalogued still star whose dot is found is Known star; 3 px on its glow is "Not a separate dot: part of"', async () => {
  const { makeGrid, gridToWorld } = await import('../web/core/align.js');
  const n = 25, grid = makeGrid(76.95, 30.4, n * 6.15, 6.15);
  const data = new Float32Array(n * n).map((_, i) => 1 + ((i * 7919) % 13) / 100);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] += 80 * Math.exp(-((i - 12) ** 2 + (j - 12) ** 2) / (2 * 0.9 ** 2)); // PSF ~1 px FWHM 2.1 px
  const st = { n, data };
  const [sra, sdec] = gridToWorld(grid, 12, 12);
  const cat = { gaia: { ok: true, stars: [] }, simbad: { ok: true, stars: [{ name: 'RW Aur A', ra: sra, dec: sdec, pmra: 7.2, pmdec: -20.3, epoch: 2000, source: 'SIMBAD', otype: 'Or*' }] } };
  const ep = [{ mjd: 60940, label: 'First season' }, { mjd: 61290, label: 'Latest season' }];
  const ringAt = (x, y) => { const [ra, dec] = gridToWorld(grid, x, y); return { ra, dec }; };
  const dotFor = (x, y) => { const d = L.dotAt(st, x, y) || L.wingPeak(st, x, y); if (!d) return null; const [ra, dec] = gridToWorld(grid, d.x, d.y); return { ra, dec, k: 0, part: !!d.part }; };
  // 2 px south: the old ring-only match missed (12.3″ > 9.2″) while the seasons check found the dot
  assert.equal(L.decideStar(cat, ringAt(12, 14), ep).status, 'clear', 'the bug: ring-only matching');
  assert.ok(L.seasonPresence([st, st], () => [[12, 14]]).k === 2, 'the seasons check sees the star\'s own dot');
  const r2 = L.decideStar(cat, ringAt(12, 14), ep, dotFor(12, 14));
  assert.equal(r2.status, 'explained'); assert.equal(r2.best.name, 'RW Aur A'); assert.equal(r2.part, false);
  assert.equal(verdictFor(r2).title, 'Known still star');
  for (const px of [0, 1]) assert.equal(verdictFor(L.decideStar(cat, ringAt(12, 12 + px), ep, dotFor(12, 12 + px))).kind, 'known-star', `${px} px`);
  // 3 px: no dot of its own there, the glow climbs to the star
  const d3 = dotFor(12, 15);
  assert.ok(d3?.part, 'walked uphill to the star');
  const r3 = L.decideStar(cat, ringAt(12, 15), ep, d3);
  assert.ok(r3.part); const v3 = verdictFor(r3);
  assert.equal(v3.title, 'Not a separate dot'); assert.equal(v3.sub, 'part of RW Aur A');
  assert.match(L.plainCheckText('star', r3), /^Your ring is on the glow of RW Aur A/);
  // 6 px: empty sky, nothing above the noise: no peak, ring only, nothing catalogued there
  assert.equal(dotFor(12, 18), null);
  assert.equal(L.decideStar(cat, ringAt(12, 18), ep, null).status, 'clear');
});

test('Master\'s rule exception: a SEPARATE peak with a real dip between it and the catalogued star is not explained by it', async () => {
  const { makeGrid, gridToWorld } = await import('../web/core/align.js');
  const n = 25, grid = makeGrid(150, 10, n * 6.15, 6.15);
  const data = new Float32Array(n * n).map((_, i) => 1 + ((i * 7919) % 13) / 100);
  const psf = (x, y, a) => { for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] += a * Math.exp(-((i - x) ** 2 + (j - y) ** 2) / (2 * 0.6 ** 2)); };
  psf(12, 12, 80); psf(12, 10, 30); // catalogued star at (12,12); an uncatalogued dot 2 px north (12.3″)
  const st = { n, data };
  const [sra, sdec] = gridToWorld(grid, 12, 12);
  const cat = { gaia: { ok: true, stars: [{ name: 'Gaia DR3 1', ra: sra, dec: sdec, pmra: 0, pmdec: 0, epoch: 2016, source: 'Gaia DR3', g: 12 }] }, simbad: { ok: true, stars: [] } };
  const ep = [{ mjd: 60940, label: 'First season' }, { mjd: 61290, label: 'Latest season' }];
  const d = L.dotAt(st, 12, 10.6); // ring 1.4 px from the star (8.6″, inside 9.2″), on the faint dot
  assert.ok(Math.abs(d.y - 10) < 0.4, `the faint dot (its centre leans a little towards the bright star): ${d.y}`);
  const [rra, rdec] = gridToWorld(grid, 12, 10.6), [dra, ddec] = gridToWorld(grid, d.x, d.y);
  const dot = { ra: dra, dec: ddec, k: 0 };
  assert.equal(L.separatePeaks(st, d, { x: 12, y: 12 }), true, 'a dip between the two peaks');
  const sep = (m) => L.separatePeaks(st, d, { x: 12, y: 12 });
  assert.equal(L.decideStar(cat, { ra: rra, dec: rdec }, ep, dot, { separate: sep }).status, 'clear', 'its own peak: the star beside it does not explain it');
  assert.equal(L.decideStar(cat, { ra: rra, dec: rdec }, ep, dot).status, 'explained', 'without the saddle test the ring match would explain it');
  // one blended source (no dip): not separate
  const one = { n, data: new Float32Array(n * n).map((_, i) => 1 + ((i * 7919) % 13) / 100) };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) one.data[j * n + i] += 80 * Math.exp(-((i - 12) ** 2 + (j - 12) ** 2) / (2 * 1.2 ** 2));
  assert.equal(L.separatePeaks(one, { x: 12, y: 12 }, { x: 12, y: 13.4 }), false);
});
