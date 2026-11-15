// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Tests for Spot's "Report this find" pack (web/app/spot/report.js; design/spec-team-extras.md item 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../web/app/spot/report.js';
import * as L from '../web/app/spot/logic.js';

const frame = (obsid, mjd, detector, wl) => ({ obsid, mjd, date: new Date((mjd - 40587) * 86400000).toISOString().slice(0, 19), detector, wavelengthUm: wl,
  uri: `ibe/data/spherex/qr/level2/2025W38_1B/l2b-v20-2025-262/${detector}/level2_${obsid}_D${detector}_spx_l2b-v20-2025-262.fits`, cut: { ra: 269.4521, dec: 4.6934, size: 0.0427 } });
function lines(st) {
  let s = L.checklistStep(L.initChecklist(), { type: 'start' });
  for (const [id, status] of Object.entries(st)) s = L.checklistStep(s, { type: 'done', id, status, text: `${id} says ${status}.`, data: { per: [] } });
  return s;
}
function input(kind = 'unexplained', field = { key: 'barnard', label: "Barnard's Star" }) {
  const s = lines({ flags: 'clear', star: kind === 'unexplained' ? 'clear' : 'explained', asteroid: 'clear', seasons: 'clear' });
  return {
    field: { ...field, centre: { ra: 269.4521, dec: 4.6934 } },
    suspect: { n: 2, ra: 269.44625, dec: 4.768778, on: 0 },
    epochs: [
      { label: 'First season', mjd: 60940.25, found: { ra: 269.4463, dec: 4.76880 }, frames: [frame('2025W38_1B_0101_1', 60930.1, 1, 0.78), frame('2025W38_1B_0101_2', 60950.4, 6, 4.9)] },
      { label: 'Latest season', mjd: 61120.5, found: { ra: 269.4458, dec: 4.76900 }, frames: [frame('2026W12_2A_0202_3', 61110.2, 3, 1.95), frame('2026W12_2A_0202_4', 61131.7, 3, 2.01)] },
    ],
    lines: s.lines, verdict: kind === 'unexplained' ? { kind, title: 'Unexplained: worth reporting', sub: '' } : { kind: 'known-star', title: 'Known star', sub: 'moving as expected' },
    colour: { text: 'like an ordinary star', ratio: 'R = 0.21 ± 0.03' }, pageHref: 'http://127.0.0.1:8787/spot.html?field=barnard', made: new Date('2026-11-15T20:00:00Z'),
  };
}

test('the JSON report has every field the spec asks for and is valid JSON', () => {
  const r = R.buildReport(input());
  const back = JSON.parse(JSON.stringify(r));
  assert.deepEqual(back, r, 'round-trips through JSON (no NaN, Infinity or undefined)');
  assert.equal(r.schema, R.REPORT_SCHEMA); assert.equal(r.practice, false); assert.equal(r.autoSubmitted, false);
  assert.equal(r.epochs.length, 2);
  const [a, b] = r.epochs;
  assert.deepEqual([a.position.ra, a.position.dec], [269.4463, 4.7688]); // RA/Dec per epoch
  assert.equal(a.mjd, 60940.25); assert.equal(a.mjdStart, 60930.1); assert.equal(a.mjdEnd, 60950.4); // dates (MJD)
  assert.deepEqual(a.detectors, [1, 6]); assert.deepEqual(b.detectors, [3]); // detectors
  assert.deepEqual(b.bands, [{ detector: 3, wavelengthUm: [1.95, 2.01] }]); // bands
  assert.equal(r.checks.length, 4); // the four checks
  assert.deepEqual(r.checks.map(c => c.id), ['flags', 'star', 'asteroid', 'seasons']);
  assert.ok(r.checks.every(c => c.result === 'Clear' && c.title && c.text));
  assert.equal(r.colour.estimate, 'like an ordinary star'); assert.match(r.colour.note, /never part of the verdict/);
  for (const e of r.epochs) for (const im of e.images) assert.match(im.url, /^https:\/\/irsa\.ipac\.caltech\.edu\/ibe\/data\/spherex\/.+\.fits\?center=269\.452100,4\.693400d&size=0\.0427$/); // IRSA image links
  assert.equal(r.shareLink, 'http://127.0.0.1:8787/spot.html?field=barnard&click=269.446250,4.768778');
  assert.deepEqual(r.howToReport.map(h => h.url), L.REPORT_LINKS.map(l => l.href));
  assert.match(r.caveat, /Most finds .* known objects or artefacts/);
  assert.ok(r.motion && r.motion.totalArcsec > 0 && r.motion.arcsecPerYear > 0);
});

test('the share link reopens the same field and click (preset, typed name, typed coordinates, latest season)', () => {
  const ring = { ra: 331.116292, dec: -56.811278 };
  assert.equal(R.shareLink('https://x.example/app/spot.html?field=a', { key: 'eps-indi-b' }, ring), 'https://x.example/app/spot.html?field=eps-indi-b&click=331.116292,-56.811278');
  assert.equal(R.shareLink('https://x.example/', { key: 'q', query: { type: 'name', name: 'Wolf 359' } }, ring, 1), 'https://x.example/spot.html?q=Wolf%20359&click=331.116292,-56.811278&on=latest');
  assert.equal(R.shareLink('https://x.example/', { key: 'q', query: { type: 'coords', ra: 10, dec: -5 } }, ring), 'https://x.example/spot.html?ra=10.00000&dec=-5.00000&click=331.116292,-56.811278');
  // and Spot's own parser reads the click back
  const u = new URL(R.shareLink('https://x.example/', { key: 'barnard' }, { ra: 269.44625, dec: 4.768778 }, 1));
  assert.deepEqual(L.parseClick(u.searchParams), { ra: 269.44625, dec: 4.768778, season: 1 });
});

test('Markdown, Backyard Worlds and MPC-style texts hold the position, dates, checks and the link', () => {
  const r = R.buildReport(input());
  const md = R.reportMarkdown(r), byw = R.bywText(r), mpc = R.mpcNotes(r);
  for (const t of [md, byw, mpc]) {
    assert.ok(t.includes(r.shareLink), 'share link');
    assert.match(t, /17h? ?57m? ?47/); // RA 17h 57m 47.1s
  }
  assert.match(md, /RA 17h 57m 47\.10s, Dec \+04° 46′ 07\.6″/);
  assert.match(md, /\| First season \| 60940\.25000 \|/); assert.match(md, /1 \(0\.78–0\.78 µm\), 6 \(4\.90–4\.90 µm\)/);
  assert.match(md, /irsa\.ipac\.caltech\.edu/); assert.match(md, /Not a known asteroid: \*\*Clear\*\*/); assert.match(md, /Colour \(estimate\): like an ordinary star/);
  assert.match(md, /zooniverse\.org\/projects\/marckuchner\/backyard-worlds-planet-9/); assert.match(md, /minorplanetcenter\.net/);
  assert.match(byw, /^Possible mover in NASA SPHEREx images/); assert.match(byw, /known objects or artefacts/);
  assert.match(mpc, /NOT the MPC 80-column/); assert.match(mpc, /2025 09 2\d\.\d{5}/); assert.match(mpc, /17 57 47\.10 +\+04 46 07\.6/);
  assert.equal(R.mpcDate(60940.25), '2025 09 22.25000');
  assert.equal(R.reportFileName(r), 'star-shift-report-barnard-suspect-2.json');
});

test('a report on an explained verdict is marked as practice everywhere', () => {
  const r = R.buildReport(input('known-star'));
  assert.equal(r.practice, true); assert.match(r.purpose, /Practice report/);
  assert.match(R.reportMarkdown(r), /\*\*Practice report\.\*\*/); assert.match(R.bywText(r), /^\[Practice only/); assert.match(R.mpcNotes(r), /PRACTICE ONLY/);
});

test('missing dots, colour and image details keep the report valid', () => {
  const inp = input();
  inp.epochs[1].found = null; inp.colour = null; delete inp.epochs[0].frames[0].cut;
  const r = R.buildReport(inp);
  JSON.parse(JSON.stringify(r));
  assert.equal(r.epochs[1].position, null); assert.equal(r.motion, null); assert.equal(r.colour, null); assert.equal(r.epochs[0].images[0].url, null);
  assert.match(R.reportMarkdown(r), /no clear dot/); assert.match(R.mpcNotes(r), /no clear dot/);
});

test('report wording: never "discovered" or "new planet", asteroids are predicted, nothing is sent', () => {
  const src = readFileSync(new URL('../web/app/spot/report.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\b(discover\w*|new planet|points|badges?)\b/i);
  assert.doesNotMatch(src, /fetch\(|sendBeacon|XMLHttpRequest/, 'the report pack never sends anything');
  const r = R.buildReport(input());
  for (const t of [R.reportMarkdown(r), R.bywText(r), R.mpcNotes(r), JSON.stringify(r)]) assert.doesNotMatch(t, /\b(discovered|new planet|detected an asteroid)\b/i);
});
