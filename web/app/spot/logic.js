// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// "Spot a mover" (DESIGN.md 34): the pure logic, no DOM and no network, so it runs in Node tests.
//  - the fields (5 NASA targets + the "Surprise me" patches),
//  - the four checks: flags at the spot, catalogue stars moved to each season's date, the JPL
//    Small-Body Identification request/answer, and "seen in at least two seasons",
//  - the checklist state machine, the verdict rule and its wording, and the report summary.

import { propagate, separationArcsec, mjdToDate } from '../../core/motion.js';
import { offsetEN, compass16, fmtArc } from '../../core/ghost.js';
import { bitsNamed } from '../../core/contam.js';
import { centroid } from '../../core/align.js';
import { formatRA, formatDec } from '../query.js';
import { PRESETS } from '../presets.js';
import { buildSbIdentParams } from '../neo/sb-ident.js';

export const PIXEL_ARCSEC = 6.15;
// The viewer's own load settings (web/app/ui.js SETTINGS), so the relay's disk cache is shared.
export const LOAD_SETTINGS = Object.freeze({ fov: 2.5, max: 120, band: 'all', stretch: 'asinh', pixels: 'smooth', view: 'frames', speed: 4, mode: 'film' });
export const MAX_SUSPECTS = 5;

// ---------------------------------------------------------------- fields
// Quick picks: NASA's five test targets, in the order of the brief.
export const QUICK_KEYS = ['barnard', 'eps-indi-b', 'wise-0855', 'rw-aur', 'r-dra'];
export const QUICK = QUICK_KEYS.map(k => {
  const p = PRESETS.find(q => q.key === k);
  return { key: p.key, label: p.key === 'wise-0855' ? 'WISE 0855−0714' : p.label, target: { ...p.target, presetKey: p.key } };
});

// "Surprise me": patches checked on 14 Nov 2026 to have at least two SPHEREx seasons (image list
// and all 120 viewer cutouts load: Centaurus 3 seasons, Leo 3, Aries 3, Virgo 3, Canis Minor 2).
// Each is centred on a fast-moving nearby star, named only in the verdict. Positions and motions
// are SIMBAD's (ICRS, J2000; full precision, so the image-list request matches the cached one).
export const SURPRISE = [
  { key: 's-cen', label: 'A patch in Centaurus', target: { name: 'Proxima Centauri', ra: 217.42894222160578, dec: -62.67949018907555, pmra: -3781.741, pmdec: 769.465, plx: 768.0665, epoch: 2000, source: 'SIMBAD' } },
  { key: 's-leo', label: 'A patch in Leo', target: { name: 'Wolf 359', ra: 164.1205036259475, dec: 7.014723134801666, pmra: -3866.338, pmdec: -2699.215, plx: 415.1794, epoch: 2000, source: 'SIMBAD' } },
  { key: 's-ari', label: 'A patch in Aries', target: { name: "Teegarden's Star", ra: 43.253715805170415, dec: 16.881286719482496, pmra: 3429.083, pmdec: -3805.541, plx: 260.9884, epoch: 2000, source: 'SIMBAD' } },
  { key: 's-vir', label: 'A patch in Virgo', target: { name: 'Ross 128', ra: 176.93498861725834, dec: 0.8045556493308333, pmra: 607.299, pmdec: -1223.028, plx: 296.3053, epoch: 2000, source: 'SIMBAD' } },
  { key: 's-cmi', label: 'A patch in Canis Minor', target: { name: "Luyten's Star", ra: 111.85207903566794, dec: 5.225789303071388, pmra: 571.232, pmdec: -3691.487, plx: 264.1269, epoch: 2000, source: 'SIMBAD' } },
];
export const ALL_FIELDS = [...QUICK, ...SURPRISE];
export const fieldByKey = (k) => ALL_FIELDS.find(f => f.key === k) || null;

// A different surprise patch from the current one. rand: () => [0, 1).
export function pickSurprise(currentKey, rand = Math.random) {
  const pool = SURPRISE.filter(f => f.key !== currentKey);
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

// For a patch with one season: the nearest built-in field (all have two or more).
export function nearestField(ra, dec) {
  let best = null;
  for (const f of ALL_FIELDS) {
    const p = propagate(f.target, 61000);
    const d = separationArcsec(ra, dec, p.ra, p.dec);
    if (!best || d < best.d) best = { field: f, d };
  }
  return best;
}

// ---------------------------------------------------------------- small formatting helpers
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDay(d) { d = d instanceof Date ? d : mjdToDate(d); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
export function seasonRange(s) { return `${fmtDay(s.startDate)} – ${fmtDay(s.endDate)}`; }
export const fmtPos = (p) => `${formatRA(p.ra)} ${formatDec(p.dec)}`;
export const fmtDeg = (p) => `${p.ra.toFixed(5)}, ${p.dec >= 0 ? '+' : '−'}${Math.abs(p.dec).toFixed(5)}`;
// "13″ NNE of your ring"
export function offsetText(from, to) {
  const sep = separationArcsec(from.ra, from.dec, to.ra, to.dec);
  if (sep < 0.5) return 'on your ring';
  const o = offsetEN(from, to);
  return `${fmtArc(sep)} ${compass16(o.e, o.n)} of your ring`;
}
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- check a: flags at the spot
// Archive flag kinds that can fake a dot (names as the FLAGS header defines them; DESIGN.md 23).
// OVERFLOW / BLOOM on a pixel is a bright star filling it: TRANSIENT and SUR_ERROR on those same
// pixels are the star itself (contam.js classifyFrame, measured on Barnard's Star), so they are dropped.
export const ARTEFACT_KINDS = [
  { id: 'cosmic', name: 'Signal jump (cosmic ray or bright star)', bits: ['TRANSIENT', 'SNOWBALL', 'HALO'] },
  { id: 'persist', name: 'Afterglow (persistence)', bits: ['PERSIST'] },
  { id: 'scatter', name: 'Scattered light', bits: ['GHOST', 'GHOST_FPA', 'GHOST_EXT'] },
  { id: 'streak', name: 'Streak', bits: ['STREAK'] },
  { id: 'bad', name: 'Bad pixel (hot, cold, dead or noisy)', bits: ['HOT', 'COLD', 'OUTLIER', 'SUR_ERROR', 'NONFUNC'] },
];
export const SPOT_RADIUS = 1.5; // grid pixels: the clicked pixel and its eight neighbours
export const FLAG_SHARE = 1 / 3; // flagged in at least a third of a season's images (and 2+) = explains a dot

// Kinds touching the spot in one frame ({ n, flags, flagNames } on the display grid).
export function flagsAtSpot(frame, x, y, r = SPOT_RADIUS) {
  const out = { kinds: new Set(), saturated: false, pixels: [] };
  if (!frame?.flags) return out;
  const n = frame.n, fn = frame.flagNames || {};
  const SAT = bitsNamed(fn, ['OVERFLOW', 'BLOOM']), STAR = bitsNamed(fn, ['TRANSIENT', 'SUR_ERROR']);
  const masks = ARTEFACT_KINDS.map(k => [k.id, bitsNamed(fn, k.bits)]);
  for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++) for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
    if (i < 0 || j < 0 || i >= n || j >= n || Math.hypot(i - x, j - y) > r) continue;
    let w = frame.flags[j * n + i]; if (!w) continue;
    if (SAT && (w & SAT)) { out.saturated = true; w &= ~STAR; }
    const here = [];
    for (const [id, m] of masks) if (m && (w & m)) { out.kinds.add(id); here.push(id); }
    if (here.length) out.pixels.push({ i, j, kinds: here });
  }
  return out;
}

// seasons: [{ label, frames }]. Returns the check result for the blinked seasons.
export function evaluateFlags(seasons, x, y) {
  const per = seasons.map(s => {
    const kinds = {}; let flagged = 0, saturated = 0;
    for (const f of s.frames) {
      const a = flagsAtSpot(f, x, y);
      if (a.saturated) saturated++;
      if (a.kinds.size) { flagged++; for (const k of a.kinds) kinds[k] = (kinds[k] || 0) + 1; }
    }
    return { label: s.label, n: s.frames.length, flagged, kinds, saturated, explains: flagged >= 2 && flagged >= FLAG_SHARE * s.frames.length };
  });
  const names = (kinds) => ARTEFACT_KINDS.filter(k => kinds[k.id]).map(k => `${k.name} ${kinds[k.id]}`).join(', ');
  const worst = per.slice().sort((a, b) => b.flagged / (b.n || 1) - a.flagged / (a.n || 1))[0];
  const satNote = per.some(p => p.saturated > p.n / 2) ? ' A bright star fills these pixels in most images (pixel overflow): that is the star itself, not a fault.' : '';
  if (worst?.explains) {
    return { status: 'explained', per, worst,
      text: `The archive flags this spot in ${worst.flagged} of ${worst.n} images of the ${worst.label.toLowerCase()} (${names(worst.kinds)}).`,
      reason: `the archive flags this spot in ${worst.flagged} of ${worst.n} images of the ${worst.label.toLowerCase()}` };
  }
  const any = per.filter(p => p.flagged);
  if (!any.length) return { status: 'clear', per, text: 'No archive flags on or next to this spot.' + satNote };
  return { status: 'clear', per,
    text: `Only ${any.map(p => `${p.flagged} of ${p.n} images of the ${p.label.toLowerCase()}`).join(' and ')} carry a flag here: too few to make a dot in a season picture, which takes the middle value of all its images.` + satNote };
}

// ---------------------------------------------------------------- check b: known stars that moved
export const STAR_MATCH_ARCSEC = 1.5 * PIXEL_ARCSEC; // 9.2″
export const GAIA_RADIUS_ARCSEC = 150;   // covers 15″/yr over the ten years from Gaia's 2016 epoch
export const SIMBAD_RADIUS_ARCSEC = 300; // covers 11″/yr over the 26 years from J2000
export const GAIA_MAG_LIMIT = 19.5;
const PLANET_TYPES = /^(Pl|Pl\?)$/;

// Clean SIMBAD main_id the way resolve.js does: 'NAME Barnard's Star' -> 'Barnard's Star'.
export const cleanSimbadName = (s) => String(s || '').replace(/^(NAME|\*|V\*)\s+/, '').replace(/\s+/g, ' ').trim();

// stars: [{ name, ra, dec, pmra, pmdec, epoch, source, g? }]; at: { ra, dec } (the ring);
// epochs: [{ mjd, label }] (the two blinked seasons). Sorted by closest predicted approach.
export function matchCatalogue(stars, at, epochs) {
  return (stars || []).filter(s => Number.isFinite(s.ra) && Number.isFinite(s.dec)).map(s => {
    const pos = epochs.map(e => propagate({ ...s, pmra: s.pmra || 0, pmdec: s.pmdec || 0 }, e.mjd));
    const seps = pos.map(p => separationArcsec(at.ra, at.dec, p.ra, p.dec));
    let k = 0; seps.forEach((v, i) => { if (v < seps[k]) k = i; });
    const pm = Math.hypot(s.pmra || 0, s.pmdec || 0) / 1000;
    const shift = pos.length > 1 ? separationArcsec(pos[0].ra, pos[0].dec, pos[pos.length - 1].ra, pos[pos.length - 1].dec) : 0;
    return { ...s, pos, seps, minSep: seps[k], at: k, pm, shift };
  }).sort((a, b) => a.minSep - b.minSep);
}

// Which catalogue entry explains the ring, if any. A star with a catalogued motion wins over an entry
// without one (SIMBAD also lists the same star from older surveys with no motion, at old positions).
export function pickStar(matches, radius = STAR_MATCH_ARCSEC) {
  const hits = matches.filter(m => m.minSep <= radius);
  if (!hits.length) return null;
  hits.sort((a, b) => (b.pm > 0) - (a.pm > 0) || (b.source === 'SIMBAD') - (a.source === 'SIMBAD') || a.minSep - b.minSep);
  return hits[0];
}

// Is it moving enough between the two blinked seasons to jump? Half a pixel or more.
export const isMover = (m) => m && m.shift >= PIXEL_ARCSEC / 2;

// gaia, simbad: { ok, stars, error }. Returns the check result.
export function decideStar({ gaia, simbad }, at, epochs) {
  const stars = [...(gaia?.ok ? gaia.stars : []), ...(simbad?.ok ? simbad.stars : [])];
  const matches = matchCatalogue(stars, at, epochs);
  const best = pickStar(matches);
  const near = matches.slice(0, 6);
  if (best) {
    const e = epochs[best.at];
    const other = epochs.length > 1 ? epochs[1 - best.at] : null;
    const text = isMover(best)
      ? `${best.name} moves ${best.pm.toFixed(2)}″ a year. Its catalogue motion puts it ${fmtArc(best.minSep)} from your ring in the ${e.label.toLowerCase()}${other ? `, and ${offsetText(at, best.pos[1 - best.at])} in the ${other.label.toLowerCase()}` : ''}.`
      : `${best.name} is catalogued ${fmtArc(best.minSep)} from your ring and moves only ${best.pm < 0.01 ? 'a tiny amount' : best.pm.toFixed(2) + '″ a year'}: it stays put between these seasons.`;
    return { status: 'explained', best, near, mover: isMover(best), text };
  }
  if (!gaia?.ok || !simbad?.ok) {
    const down = [!gaia?.ok && 'Gaia', !simbad?.ok && 'SIMBAD'].filter(Boolean).join(' and ');
    return { status: 'failed', near, text: `${down} did not answer, so known stars could not all be checked.`, reason: `${down} not answering` };
  }
  return { status: 'clear', near, text: 'No catalogued star whose motion puts it here.' };
}

// Gaia rows (resolve.js gaiaCone) -> star list; drops sources too faint for SPHEREx to show.
export function gaiaStars(rows) {
  return (rows || []).filter(r => r.g == null || r.g <= GAIA_MAG_LIMIT)
    .map(r => ({ name: r.id, ra: r.ra, dec: r.dec, pmra: r.pmra || 0, pmdec: r.pmdec || 0, epoch: 2016, source: 'Gaia DR3', g: r.g }));
}
// SIMBAD rows (main_id, ra, dec, pmra, pmdec, otype) -> star list; planets share their star's entry, so they go.
export function simbadStars(rows) {
  const num = (v) => (v === '' || v == null ? null : Number(v));
  return (rows || []).filter(r => !PLANET_TYPES.test(String(r.otype || '').trim()))
    .map(r => ({ name: cleanSimbadName(r.main_id), ra: num(r.ra), dec: num(r.dec), pmra: num(r.pmra) || 0, pmdec: num(r.pmdec) || 0, epoch: 2000, source: 'SIMBAD', otype: r.otype }));
}
export function simbadConeADQL(ra, dec, radiusArcsec = SIMBAD_RADIUS_ARCSEC, top = 400) {
  return `SELECT TOP ${top | 0} main_id, ra, dec, pmra, pmdec, otype FROM basic WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${(+ra).toFixed(6)}, ${(+dec).toFixed(6)}, ${(radiusArcsec / 3600).toFixed(6)})) = 1`;
}

// ---------------------------------------------------------------- check c: JPL Small-Body Identification
// The relay route /jpl/sb_ident (Codex's proxy/jpl.js) accepts only these query names.
export const SB_IDENT_ALLOWED = ['mpc-code', 'lat', 'lon', 'alt', 'dxy', 'dz', 'xobs', 'xobs-hel', 'obs-time', 'vmag-lim', 'fov-ra-lim', 'fov-dec-lim',
  'fov-ra-center', 'fov-dec-center', 'fov-ra-hwidth', 'fov-dec-hwidth', 'two-pass', 'mag-required', 'suppress-first-pass', 'req-elem', 'sb-group', 'sb-kind'];
export const ASTEROID_MATCH_ARCSEC = 15;  // 2.4 pixels: our click, the season stack and the observer offset (below)
export const ASTEROID_HALF_WIDTH_DEG = 0.03; // 108″ box around the ring: shows the nearest objects as evidence
export const JPL_TIMEOUT_MS = 120000; // sb_ident took 50-75 s per request through the relay (lead, 14 Nov 2026)

// '2025-08-15T20:46:08.896' (an image's DATE-AVG) -> '2025-08-15_20:46:08' (JPL obs-time, full UTC)
export function utcToJplTime(utc) {
  const m = /^(\d{4}-\d{2}-\d{2})[T _](\d{2}:\d{2}:\d{2})/.exec(String(utc || ''));
  if (!m) throw new TypeError('Need an image time like 2025-08-15T20:46:08');
  return `${m[1]}_${m[2]}`;
}

// One request per blinked season, at the real time of that season's middle image. Built with the
// Asteroid Spotter's own helper (web/app/neo/sb-ident.js), then: the image's full UTC time instead of
// 12:00, and no sb-kind, so asteroids and comets come back in one request. Observer: 'mpc-500' first;
// JPL's docs refuse 500 ("never 500 'geocentric'"), so the caller retries with 'geocentric-state'
// (xobs=0,0,0,0,0,0), as the Spotter does. SPHEREx orbits ~700 km up: for a main-belt asteroid
// that shifts it by under 2″, well inside ASTEROID_MATCH_ARCSEC.
export function sbIdentParams({ ra, dec, utc, observer = 'mpc-500', halfWidthDeg = ASTEROID_HALF_WIDTH_DEG }) {
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) throw new TypeError('Need a position');
  const time = utcToJplTime(utc);
  const p = buildSbIdentParams({ ra, dec, fov: 2 * halfWidthDeg, date: time.slice(0, 10), kind: 'a', observer });
  p.set('obs-time', time);
  p.delete('sb-kind');
  return p;
}
export const sbIdentPath = (o) => `/jpl/sb_ident?${sbIdentParams(o)}`;

const fnum = (v) => (v === '' || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
function sexa(s, hours) {
  const m = /^\s*([+-]?)(\d+)[\s:](\d+)[\s:'](\d+(?:\.\d+)?)/.exec(String(s || ''));
  if (!m) return null;
  const v = (Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600) * (hours ? 15 : 1);
  return m[1] === '-' ? -v : v;
}
// sb_ident JSON -> [{ name, ra, dec, dist (″ from the box centre), err (″), vmag }]
export function parseSbIdent(json) {
  const second = Array.isArray(json?.data_second_pass);
  const fields = second ? json.fields_second : json?.fields_first;
  const data = second ? json.data_second_pass : json?.data_first_pass;
  if (!Array.isArray(fields) || !Array.isArray(data)) return [];
  const col = (re) => fields.findIndex(f => re.test(f));
  const iN = col(/^Object name/i), iRa = col(/Astrometric RA/i), iDec = col(/Astrometric Dec/i), iD = col(/Norm/i),
    iV = col(/Visual magnitude/i), iE = col(/Est\. error RA/i), iE2 = col(/Est\. error Dec/i);
  return data.map(r => ({
    name: String(r[iN] ?? 'Unnamed object').trim(),
    ra: sexa(r[iRa], true), dec: sexa(r[iDec], false),
    dist: fnum(r[iD]), vmag: fnum(r[iV]),
    err: iE >= 0 ? Math.max(fnum(r[iE]) ?? 0, iE2 >= 0 ? fnum(r[iE2]) ?? 0 : 0) : null,
  })).sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
}
export const isComet = (name) => /^(\d+[PCDXI]\/|[PCDXI]\/)/.test(String(name).trim());

// An object matches when its predicted place, allowing for its own stated error (at most 30″), is within the radius.
export const asteroidHit = (row, radius = ASTEROID_MATCH_ARCSEC) =>
  Number.isFinite(row.dist) && row.dist - Math.min(row.err ?? 0, 30) <= radius;

// results: [{ label, mjd, ok, rows, error, status }] one per blinked season.
export function decideAsteroid(results) {
  for (const r of results) {
    const hit = r.ok ? r.rows.find(row => asteroidHit(row)) : null;
    if (hit) return { status: 'explained', hit, season: r, text: `JPL predicts ${hit.name} ${fmtArc(hit.dist)} from your ring on ${fmtDay(r.mjd)}${r.utc ? `, ${r.utc.slice(11, 16)} UTC` : ''}.` };
  }
  const bad = results.filter(r => !r.ok);
  if (bad.length) {
    const why = bad[0].status === 404 ? 'the JPL lookup is not switched on in this copy of the app yet (HTTP 404)'
      : bad[0].status ? `JPL answered HTTP ${bad[0].status}` : `JPL did not answer (${bad[0].error || 'no reply'})`;
    return { status: 'failed', text: `Could not ask JPL: ${why}.`, reason: why };
  }
  return { status: 'clear', text: 'No known Solar System object here on these dates.' };
}

// ---------------------------------------------------------------- check d: seen in at least two seasons
export const DETECT_SEARCH_PX = 2;
export const DETECT_MIN_SNR = 5;
// A clear dot near (x, y) in a stacked season picture ({ n, data }), or null.
export function detectNear(stack, x, y, { search = DETECT_SEARCH_PX, minSnr = DETECT_MIN_SNR } = {}) {
  const n = stack.n;
  let best = -Infinity, bx = Math.round(x), by = Math.round(y);
  for (let j = Math.floor(y - search); j <= Math.ceil(y + search); j++) for (let i = Math.floor(x - search); i <= Math.ceil(x + search); i++) {
    if (i < 0 || j < 0 || i >= n || j >= n || Math.hypot(i - x, j - y) > search) continue;
    const v = stack.data[j * n + i];
    if (Number.isFinite(v) && v > best) { best = v; bx = i; by = j; }
  }
  if (best === -Infinity) return null;
  const c = centroid(stack, bx, by, 2);
  if (!c || !(c.snr >= minSnr) || Math.hypot(c.x - x, c.y - y) > search + 0.5) return null;
  return { x: c.x, y: c.y, snr: c.snr };
}

// stacks: [{ label, n, data }]; pointsFor(k): candidate grid positions in season k (the ring, plus a
// known mover's predicted place). Returns { per: [{ label, found }], k, N }.
export function seasonPresence(stacks, pointsFor) {
  const per = stacks.map((s, i) => {
    let found = null;
    for (const [x, y] of pointsFor(i)) { const d = detectNear(s, x, y); if (d && (!found || d.snr > found.snr)) found = d; }
    return { label: s.label, found };
  });
  return { per, k: per.filter(p => p.found).length, N: per.length };
}
export function decideSeasons(pres) {
  const { k, N } = pres;
  if (k >= 2) return { status: 'clear', ...pres, text: `Present in ${k} of ${N} seasons.` };
  return { status: 'explained', ...pres,
    text: k === 1 ? `Seen as a clear dot in only 1 of ${N} seasons.` : `Not a clear dot in any of the ${N} seasons.`,
    reason: k === 1 ? `it shows as a clear dot in only 1 of ${N} seasons` : `it is not a clear dot in any of the ${N} seasons` };
}

// ---------------------------------------------------------------- checklist state machine
export const CHECKS = [
  { id: 'flags', title: 'Not a flagged pixel' },
  { id: 'star', title: 'Not a known star that moved' },
  { id: 'asteroid', title: 'Not a known asteroid' },
  { id: 'seasons', title: 'Seen in at least two seasons' },
];
export const STATE_WORD = { pending: 'Waiting', checking: 'Checking…', clear: 'Clear', explained: 'Explained', failed: 'Could not check' };
export const checkTitle = (id) => CHECKS.find(c => c.id === id)?.title || id;

export function initChecklist() {
  return { lines: CHECKS.map(c => ({ id: c.id, status: 'pending', text: '', data: null })), cursor: -1 };
}
const nextPending = (lines, from) => { for (let i = from; i < lines.length; i++) if (lines[i].status === 'pending') return i; return lines.length; };
// Actions: { type: 'start' } · { type: 'done', id, status, text, data } (only the line being checked) ·
// { type: 'retry', id } (a line that could not check runs again; the others keep their results).
export function checklistStep(state, action) {
  const lines = state.lines.map(l => ({ ...l }));
  if (action.type === 'start') {
    const fresh = initChecklist();
    fresh.lines[0].status = 'checking'; fresh.cursor = 0;
    return fresh;
  }
  if (action.type === 'done') {
    const i = lines.findIndex(l => l.id === action.id);
    if (i < 0 || i !== state.cursor || lines[i].status !== 'checking') return state;
    if (!['clear', 'explained', 'failed'].includes(action.status)) return state;
    lines[i] = { ...lines[i], status: action.status, text: action.text || '', data: action.data ?? null };
    const nx = nextPending(lines, i + 1);
    if (nx < lines.length) lines[nx].status = 'checking';
    return { lines, cursor: nx };
  }
  if (action.type === 'retry') {
    const i = lines.findIndex(l => l.id === action.id);
    if (i < 0 || lines[i].status !== 'failed' || state.cursor < lines.length) return state;
    lines[i] = { ...lines[i], status: 'checking', text: '', data: null };
    return { lines, cursor: i };
  }
  return state;
}
export const isFinished = (state) => state.cursor >= state.lines.length;

// ---------------------------------------------------------------- verdict
// Spec order (DESIGN.md 34): Known star · Likely artefact · Known asteroid · Unexplained.
// A check that EXPLAINS the suspect decides the verdict even when another check could not run
// (the missing check could not undo that explanation); "Unexplained" needs all four clear;
// with no explanation and a check that could not run, there is no verdict.
export function decideVerdict(state) {
  if (!isFinished(state)) return { kind: 'pending' };
  const by = Object.fromEntries(state.lines.map(l => [l.id, l]));
  const failed = state.lines.filter(l => l.status === 'failed').map(l => l.id);
  const notRun = failed.length ? `The ${failed.map(id => `"${checkTitle(id)}"`).join(' and ')} check could not run; it would not change this answer.` : null;
  if (by.star.status === 'explained') {
    const b = by.star.data?.best, mover = by.star.data?.mover;
    const name = b?.name || 'a catalogued star';
    return { kind: 'known-star', title: 'Known star', sub: mover ? 'moving as expected' : 'not moving between these seasons',
      body: mover ? [`This is ${name}, a star known to move this much.`, 'You found it by eye: that is exactly how it is done.']
        : [`This is ${name}, a catalogued star.`, 'Its catalogued motion is too small to shift it between these seasons, so a change you saw is in brightness, not position.'],
      evidence: [by.star.text], notRun, decidedBy: 'star' };
  }
  if (by.asteroid.status === 'explained') {
    const h = by.asteroid.data?.hit;
    return { kind: 'known-asteroid', title: isComet(h?.name) ? 'Known comet' : 'Known asteroid', sub: 'passing through',
      body: [`This is ${h?.name || 'a known Solar System object'}, a known ${isComet(h?.name) ? 'comet' : 'asteroid'}, passing through.`, 'JPL\'s orbit list predicts it at this spot on this date.'],
      evidence: [by.asteroid.text], notRun, decidedBy: 'asteroid' };
  }
  const why = [];
  if (by.flags.status === 'explained') why.push(by.flags.text);
  if (by.seasons.status === 'explained') why.push(by.seasons.text);
  const fp = by.flags.status === 'explained' ? [] : (by.flags.data?.per || []).filter(p => p.flagged);
  if (why.length && fp.length) why.push(`The archive also flags this spot in ${fp.map(p => `${p.flagged} of ${p.n} images of the ${p.label.toLowerCase()}`).join(' and ')}.`);
  if (why.length) {
    return { kind: 'artefact', title: 'Likely artefact', sub: '', body: ['This is most likely not a real object.', 'Here is why.'],
      evidence: why, notRun, decidedBy: by.flags.status === 'explained' ? 'flags' : 'seasons' };
  }
  if (failed.length) {
    const names = failed.map(id => `"${checkTitle(id)}"`).join(' and ');
    return { kind: 'incomplete', title: 'We could not finish checking', sub: '',
      body: [`The ${names} check could not run.`, `Retry ${failed.length > 1 ? 'them' : 'it'} to get a verdict.`],
      evidence: failed.map(id => by[id].text), retry: failed };
  }
  return { kind: 'unexplained', title: 'Unexplained: worth reporting', sub: '',
    body: ['None of our checks explains this.', 'That does not make it a discovery, but it is worth a second look by people who do this for a living.'],
    evidence: [`All four checks came back clear; ${(by.seasons.text || '').replace(/\.$/, '').toLowerCase()}.`] };
}

// ---------------------------------------------------------------- report summary (nothing about the user)
export const DOIS = 'IRSA SPHEREx Quick Release 2 (DOI 10.26131/IRSA652) and Quick Release 3 (DOI 10.26131/IRSA662)';
export const REPORT_LINKS = [
  { name: 'Backyard Worlds: Planet 9 (Zooniverse)', href: 'https://www.zooniverse.org/projects/marckuchner/backyard-worlds-planet-9',
    forWhat: 'for faint objects far beyond the planets that creep across the sky over years, like brown dwarfs' },
  { name: 'Minor Planet Center', href: 'https://www.minorplanetcenter.net/',
    forWhat: 'for asteroids and comets: objects in our Solar System that move from night to night' },
];

// s: { fieldLabel, centre {ra,dec}, suspect { n, ra, dec }, seasons: [{ label, startDate, endDate, mjd, count,
// wl: [lo, hi] µm, obsids: [], found: { ra, dec } | null }], lines: checklist lines, verdict }
export function summaryText(s) {
  const L = [];
  L.push(`Star Shift suspect ${s.suspect.n} · ${s.fieldLabel}`);
  L.push(`Field centre (J2000): ${fmtPos(s.centre)} (${fmtDeg(s.centre)} deg)`);
  L.push(`Suspect ring (J2000): ${fmtPos(s.suspect)} (${fmtDeg(s.suspect)} deg)`);
  for (const se of s.seasons) {
    L.push('');
    L.push(`${se.label}: ${seasonRange(se)}, middle MJD ${se.mjd.toFixed(3)}, median of ${plural(se.count, 'image')}`);
    L.push(`  Wavelengths: ${se.wl ? `${se.wl[0].toFixed(2)}–${se.wl[1].toFixed(2)} µm (SPHEREx bands combined)` : 'not recorded'}`);
    L.push(`  Suspect in this image: ${se.found ? `${fmtPos(se.found)} (${fmtDeg(se.found)} deg)` : 'no clear dot within 2 pixels of the ring'}`);
    L.push(`  Image IDs: ${se.obsids.join(', ')}`);
  }
  L.push('');
  L.push('Checks:');
  for (const l of s.lines) L.push(`  ${checkTitle(l.id)}: ${STATE_WORD[l.status]}. ${l.text}`);
  if (s.verdict?.title) L.push(`Verdict: ${s.verdict.title}${s.verdict.sub ? ` (${s.verdict.sub})` : ''}`);
  L.push('');
  L.push(`Made with Star Shift from NASA SPHEREx data via IRSA: ${DOIS}. Catalogues: Gaia DR3, SIMBAD, JPL Small-Body Identification.`);
  return L.join('\n');
}
