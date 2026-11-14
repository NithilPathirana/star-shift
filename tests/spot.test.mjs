// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Tests for "Spot a mover" (DESIGN.md 34): web/app/spot/logic.js and checks.js, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../web/app/spot/logic.js';
import { runStarCheck, runAsteroidCheck } from '../web/app/spot/checks.js';
import { propagate } from '../web/core/motion.js';
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
  assert.equal(star.status, 'clear'); assert.match(star.text, /bright star fills these pixels/);
  assert.equal(L.evaluateFlags([{ label: 'First season', frames: [frame()] }], 4, 4).text, 'No archive flags on or next to this spot.');
  // two pixels away is not "on or next to"
  assert.equal(L.flagsAtSpot(frame({ [4 * 9 + 6]: 1 }), 4, 4).kinds.size, 0);
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
test('field-level lookups: one JPL request per season for the whole patch serves every click', async () => {
  const { fetchFieldAsteroids, asteroidCheckAt } = await import('../web/app/spot/checks.js');
  const seen = [];
  const results = await fetchFieldAsteroids({ centre: { ra: 269.446, dec: 4.77 }, base: '', fetchFn: async (u) => { seen.push(u); return res(200, SB); },
    seasons: [{ label: 'First season', mjd: 1, utc: '2025-08-15T20:46:08' }, { label: 'Latest season', mjd: 2, utc: '2026-08-23T23:02:00' }] });
  assert.equal(seen.length, 2); assert.match(seen[0], /fov-ra-center=17-57-47\.04&fov-dec-center=04-46-12\.00&fov-ra-hwidth=0\.035/);
  const rows = results[0].rows, onIt = { ra: rows[1].ra, dec: rows[1].dec };
  assert.equal(asteroidCheckAt(results, onIt).status, 'explained');
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
  assert.equal(r.status, 'explained');
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

// ---------- summary and words
test('the report summary holds the sky facts and nothing about the user', () => {
  const s = finished({ flags: 'clear', star: 'clear', asteroid: 'clear', seasons: 'clear' });
  const txt = L.summaryText({ fieldLabel: 'A patch in Leo', centre: { ra: 164.1, dec: 7 }, suspect: { n: 2, ra: 164.101, dec: 7.001 },
    seasons: [{ label: 'First season', startDate: new Date('2025-04-28'), endDate: new Date('2025-06-07'), mjd: 60810.5, count: 48, wl: [0.75, 4.98], obsids: ['2025W18_1A_0001_1'], found: { ra: 164.101, dec: 7.001 } }],
    lines: s.lines, verdict: L.decideVerdict(s) });
  for (const want of ['Field centre (J2000): 10h 56m 24.00s +07° 00′ 00.0″', 'Suspect ring', '28 Apr 2025 – 7 Jun 2025', '0.75–4.98 µm', '2025W18_1A_0001_1', 'Not a known asteroid: Clear.',
    'Verdict: Unexplained: worth reporting', 'Made with Star Shift from NASA SPHEREx data via IRSA', '10.26131/IRSA652', '10.26131/IRSA662']) assert.ok(txt.includes(want), want);
  assert.doesNotMatch(txt, /user|name:|email|location/i);
});
test('banned words and things never appear on the page', () => {
  const src = ['../web/spot.html', '../web/app/spot/main.js', '../web/app/spot/logic.js', '../web/app/spot/checks.js', '../web/styles/spot.css']
    .map(f => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, /\b(discovered|new planet|you found a new object|confetti|badges?|leaderboards?|day streak|points)\b/i); // "Streak" alone is an archive flag kind
  const html = readFileSync(new URL('../web/spot.html', import.meta.url), 'utf8');
  assert.match(html, /<span class="ai-mark rail-ai"/); assert.match(html, /<span class="ai-mark top-ai"/);
  assert.match(html, /Logo: AI-generated with ChatGPT; small-size version and favicon redrawn as SVG by Claude\./);
  assert.match(html, /class="nav-btn nav-demote" href="planetarium.html" title="Can I see it tonight\?"/);
  assert.match(html, /href="spot.html" aria-current="page"/);
  assert.doesNotMatch(html, /<img[^>]+(nasa|spherex)[^>]*>/i, 'no agency logos');
  for (const l of L.REPORT_LINKS) assert.match(l.href, /^https:\/\//);
});
