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
import { groupByDets } from '../viewerbits.js';

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

// Detectors Spot stacks for a field (judging panel A4): a preset with motionDetectors (WISE 0855:
// 5–6, the only detectors where it shows) is blinked on those alone, so the dot you see is the
// brown dwarf and not a Gaia G 16.3 star 7.8″ away that fills the shorter wavelengths. null = all.
// band: the header line, "Showing 3.8–5.0 µm: WISE 0855 is invisible at shorter wavelengths".
export function fieldBand(f) {
  const p = PRESETS.find(q => q.key === (f?.target?.presetKey || f?.key));
  const dets = Array.isArray(p?.motionDetectors) && p.motionDetectors.length ? p.motionDetectors.slice().sort((a, b) => a - b) : null;
  if (!dets) return null;
  const g = groupByDets(dets);
  const um = g ? g.label : `detectors ${dets.join(', ')}`;
  return { dets, um, text: `Showing ${um}${p.holdNote ? `: ${p.holdNote}` : ''}` };
}
// The frames to stack: those on the field's detectors, unless that leaves fewer than two seasons.
export function framesForField(frames, band, seasonsOf) {
  if (!band) return { frames, band: null };
  const on = frames.filter(fr => band.dets.includes(Number(fr.detector)));
  return seasonsOf(on).length >= 2 ? { frames: on, band } : { frames, band: null };
}

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
  const satNote = saturationText(per);
  if (worst?.explains) {
    return { status: 'explained', per, worst,
      text: `The archive flags this spot in ${worst.flagged} of ${worst.n} images of the ${worst.label.toLowerCase()} (${names(worst.kinds)}).${satNote}`,
      reason: `the archive flags this spot in ${worst.flagged} of ${worst.n} images of the ${worst.label.toLowerCase()}` };
  }
  const any = per.filter(p => p.flagged);
  if (!any.length) return { status: 'clear', per, text: 'No archive flags on or next to this spot.' + satNote };
  return { status: 'clear', per,
    text: `Only ${any.map(p => `${p.flagged} of ${p.n} images of the ${p.label.toLowerCase()}`).join(' and ')} carry a fault flag here: too few to make a dot in a season picture, which takes the middle value of all its images.` + satNote };
}
// Saturation is reported on its own line, not as a fault flag (judging panel a11: the Proof page
// counts the saturated centre separately too). Counts are per season, as the flag counts above.
export function saturationText(per) {
  const sat = per.filter(p => p.saturated > 0);
  if (!sat.length) return '';
  const most = sat.some(p => p.saturated > p.n / 2);
  return ` The centre is saturated (pixel overflow) in ${sat.map(p => `${p.saturated} of ${p.n} images of the ${p.label.toLowerCase()}`).join(' and ')}: ${most ? 'that is the star itself' : 'a bright star filling those pixels'}, not a fault, so it is not counted as a flag.`;
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
// epochs: [{ mjd, label }] (the two blinked seasons); dot: { ra, dec, k } or null, the measured centre
// of the dot you clicked, in blinked season k (dotAt below). Each entry gets `ref`: its distance from
// that centre in that season, or (no dot) its closest approach to the ring. Sorted by `ref`.
export function matchCatalogue(stars, at, epochs, dot = null) {
  return (stars || []).filter(s => Number.isFinite(s.ra) && Number.isFinite(s.dec)).map(s => {
    const pos = epochs.map(e => propagate({ ...s, pmra: s.pmra || 0, pmdec: s.pmdec || 0 }, e.mjd));
    const seps = pos.map(p => separationArcsec(at.ra, at.dec, p.ra, p.dec));
    let k = 0; seps.forEach((v, i) => { if (v < seps[k]) k = i; });
    const pm = Math.hypot(s.pmra || 0, s.pmdec || 0) / 1000;
    const shift = pos.length > 1 ? separationArcsec(pos[0].ra, pos[0].dec, pos[pos.length - 1].ra, pos[pos.length - 1].dec) : 0;
    const dk = dot && pos[dot.k] ? dot.k : -1;
    const ref = dk >= 0 ? separationArcsec(dot.ra, dot.dec, pos[dk].ra, pos[dk].dec) : seps[k];
    return { ...s, pos, seps, minSep: seps[k], at: k, pm, shift, ref, refAt: dk >= 0 ? dk : k };
  }).sort((a, b) => a.ref - b.ref);
}

// Two catalogue entries closer together than this, as seen from the clicked dot, cannot be told
// apart (judging panel A4). Physics: a SPHEREx pixel is 6.15″ and the PSF about one pixel, so a
// dot's centre at 5× the noise is good to ~FWHM/(2.35 × 5) ≈ 0.5-1″; the catalogue motion is
// propagated without the parallax wobble (up to 0.55″ for Barnard's Star, 0.44″ for WISE 0855); and
// a season stack is the middle value of images spread over weeks. 1.5″ (a quarter pixel) covers
// those together. Inside that tie a moving entry wins: SIMBAD also lists moving stars again from
// older surveys with no motion, and those copies sit right beside the real star.
export const STAR_TIE_ARCSEC = 1.5;

// Which catalogue entry explains the ring, if any (judging panel A4: the NEAREST one, not the first
// moving one within 9.2″). Master's rule (Sun 15 Nov, after the RW Aur false "worth reporting"): an
// entry qualifies when its predicted place on that date lies within 1.5 × the PSF FWHM of the click
// (the ring, in either season) OR of the peak the click belongs to (the clicked dot's measured centre,
// or the top its glow climbs to). FWHM: the documented SPHEREx value, about one 6.15″ pixel, so
// 1.5 × FWHM = STAR_MATCH_ARCSEC = 9.2″. The one exception: `separate(m)` says the clicked dot is its
// own peak with a real dip (saddle) between it and that entry's place; then nearness to the ring
// alone does not count. Among the qualifiers, the one closest to the peak wins (to the ring when
// there is none). Ties within STAR_TIE_ARCSEC: a mover, then any catalogued motion, then SIMBAD (a
// name rather than a Gaia number), then the closer one.
export function pickStar(matches, radius = STAR_MATCH_ARCSEC, tie = STAR_TIE_ARCSEC, separate = null) {
  const ref = (m) => (Number.isFinite(m.ref) ? m.ref : m.minSep);
  const hits = matches.filter(m => ref(m) <= radius || (m.minSep <= radius && !(separate && separate(m))));
  if (!hits.length) return null;
  const d0 = Math.min(...hits.map(ref));
  const close = hits.filter(m => ref(m) <= d0 + tie);
  close.sort((a, b) => isMover(b) - isMover(a) || (b.pm > 0) - (a.pm > 0) || (b.source === 'SIMBAD') - (a.source === 'SIMBAD') || ref(a) - ref(b));
  return close[0];
}

// Is it moving enough between the two blinked seasons to jump? Half a pixel or more.
export const isMover = (m) => !!m && m.shift >= PIXEL_ARCSEC / 2;

// What kind of object a catalogue entry is, for the wording (judging panel A4: WISE 0855 is a brown
// dwarf, not "a star"). SIMBAD object types: BD* brown dwarf, WD* white dwarf; a preset's own note
// ("Coldest known brown dwarf") counts too. Anything else (Gaia rows have no type) is a star.
export function objectWord(s) {
  const t = String(s?.otype || '').trim();
  if (/^BD\*/.test(t) || /brown dwarf/i.test(String(s?.note || ''))) return 'brown dwarf';
  if (/^WD\*/.test(t)) return 'white dwarf';
  return 'star';
}
// "Gaia DR3 5756956644387831296, G 16.3" (Gaia's G magnitude when we have it)
export const starLabel = (s) => `${s.name}${Number.isFinite(s.g) ? `, G ${s.g.toFixed(1)}` : ''}`;

// gaia, simbad: { ok, stars, error }; dot: the peak the click belongs to, { ra, dec, k, part }: the
// clicked dot's measured centre (dotAt), or with part: true the top of the glow the ring sits on
// (wingPeak). separate(m): see pickStar. Returns the check result; part: true when the ring is on
// the glow of the named star rather than on a dot of its own ("Not a separate dot: part of …").
export function decideStar({ gaia, simbad }, at, epochs, dot = null, { separate = null } = {}) {
  const stars = [...(gaia?.ok ? gaia.stars : []), ...(simbad?.ok ? simbad.stars : [])];
  const matches = matchCatalogue(stars, at, epochs, dot);
  const best = pickStar(matches, STAR_MATCH_ARCSEC, STAR_TIE_ARCSEC, separate);
  const near = matches.slice(0, 6);
  if (best) {
    const e = epochs[best.at];
    const other = epochs.length > 1 ? epochs[1 - best.at] : null;
    const mover = isMover(best), word = objectWord(best);
    const part = !!dot?.part && best.minSep > PIXEL_ARCSEC / 2; // the ring is on the star's glow, not on its dot
    const from = !dot ? 'your ring' : dot.part ? 'the top of the glow your ring sits on' : 'the centre of the dot you clicked';
    const dotTxt = !dot ? '' : dot.part ? ` Your ring sits on its glow: the light climbs to a peak ${fmtArc(best.ref)} from its place in the ${epochs[best.refAt].label.toLowerCase()}.`
      : ` The dot you clicked is centred ${fmtArc(best.ref)} from its place in the ${epochs[best.refAt].label.toLowerCase()}.`;
    // the closest entry of the other kind (a still star beside a mover, or the reverse), and why it lost
    const rival = matches.find(m => m !== best && (m.minSep <= STAR_MATCH_ARCSEC || m.ref <= STAR_MATCH_ARCSEC) && isMover(m) !== mover);
    const tied = rival && rival.ref - best.ref <= STAR_TIE_ARCSEC;
    const rivalTxt = !rival ? ''
      : isMover(rival) ? ` ${rival.name}, a ${objectWord(rival)} that moves ${rival.pm.toFixed(2)}″ a year, is predicted ${fmtArc(rival.ref)} from ${from}: further away, so this dot is not it.`
        : ` ${starLabel(rival)}, a still star, is ${fmtArc(rival.ref)} from ${from}${tied ? ': too close to tell apart, so the moving one is named' : ': further away'}.`;
    const text = mover
      ? `${best.name} moves ${best.pm.toFixed(2)}″ a year. Its catalogue motion puts it ${fmtArc(best.minSep)} from your ring in the ${e.label.toLowerCase()}${other ? `, and ${offsetText(at, best.pos[1 - best.at])} in the ${other.label.toLowerCase()}` : ''}.${dotTxt}${rivalTxt}`
      : `${starLabel(best)} is catalogued ${fmtArc(dot ? best.ref : best.minSep)} from ${from} and moves only ${best.pm < 0.01 ? 'a tiny amount' : best.pm.toFixed(2) + '″ a year'}: it stays put between these seasons.${part ? ` Your ring is ${fmtArc(best.minSep)} from it, on its glow.` : ''}${rivalTxt}`;
    return { status: 'explained', best, near, mover, word, rival: rival || null, dot: dot || null, part, text };
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
export const ASTEROID_MATCH_ARCSEC = 12;  // 2 pixels: our click, the season stack and the observer offset (below)
// One request per FIELD and season (not per click), so the five demo fields answer from web/prebaked/
// for any click: a box centred on the patch, half-width 126″ (the 25 × 6.15″ patch reaches 109″
// from its centre at the corners, plus a margin).
export const FIELD_HALF_WIDTH_DEG = 0.035;
export const ASTEROID_HALF_WIDTH_DEG = FIELD_HALF_WIDTH_DEG;
export const FIELD_REACH_ARCSEC = 110; // centre to corner of the patch
// The patch centre used for the field-level catalogue and JPL requests, rounded so the request (and
// the prebaked key) is the same in Node and every browser.
export const fieldCentre = (grid) => ({ ra: +grid.ra0.toFixed(6), dec: +grid.dec0.toFixed(6) });
export const JPL_TIMEOUT_MS = 90000; // whole JPL budget per season (both observer tries); sb_ident took 50-75 s (lead, 14 Nov 2026)

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
// sb_ident JSON -> [{ name, ra, dec, dist (″ from the box centre), err (″), vmag, raRate, decRate (″/h) }]
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
    raRate: rate(fields, r, /^RA rate/i), decRate: rate(fields, r, /^Dec rate/i),
  })).sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
}
// A rate column in ″/h whatever unit JPL labels it with (″/h with xobs; deg/s or deg/d otherwise).
function rate(fields, r, re) {
  const i = fields.findIndex(f => re.test(f)); if (i < 0) return null;
  const v = fnum(r[i]); if (v == null) return null;
  const f = fields[i];
  if (/deg\s*\/\s*s/i.test(f)) return v * 3600 * 3600;
  if (/deg\s*\/\s*d/i.test(f)) return v * 3600 / 24;
  return v;
}
export const isComet = (name) => /^(\d+[PCDXI]\/|[PCDXI]\/)/.test(String(name).trim());

// How far an object's predicted path passes from the ring (″): its place at the middle image's time,
// and, when JPL gives its rates, anywhere along its track within ±1 h of that time (allowing for
// the rate and for when in the image set it was caught; the stack itself spans weeks, so a longer
// track would explain any spot it crosses).
export const TRACK_HOURS = 1;
export function passDistance(row, at) {
  if (!Number.isFinite(row.ra) || !Number.isFinite(row.dec)) return Number.isFinite(row.dist) && !at ? row.dist : Infinity;
  const o = offsetEN({ ra: row.ra, dec: row.dec }, at); // ring relative to the object, ″ east / north
  const ve = Number.isFinite(row.raRate) ? row.raRate : 0, vn = Number.isFinite(row.decRate) ? row.decRate : 0; // ″/h
  const v2 = ve * ve + vn * vn;
  let t = v2 ? (o.e * ve + o.n * vn) / v2 : 0;
  t = Math.max(-TRACK_HOURS, Math.min(TRACK_HOURS, t));
  return Math.hypot(o.e - ve * t, o.n - vn * t);
}
// An object matches when its path, allowing for its own stated error (at most 30″), is within the radius.
export const asteroidHit = (row, at, radius = ASTEROID_MATCH_ARCSEC) => passDistance(row, at) - Math.min(row.err ?? 0, 30) <= radius;

// A known object near the ring only explains the dot if SPHEREx could see it. SPHEREx's single-image
// point-source depth is roughly AB 18.5-19.5 (approximate; it varies with wavelength band and sky
// background, and an asteroid's V magnitude is only a rough guide to its infrared brightness), so
// we take the bright end: V ≤ 18.5. An object JPL gives no magnitude for cannot be ruled out.
export const SPHEREX_VISIBLE_V = 18.5;
const bodyWord = (name) => (isComet(name) ? 'comet' : 'asteroid');
const plainName = (name) => String(name || 'an unnamed object').trim().replace(/^\((.*)\)$/, '$1');
const vText = (row) => (Number.isFinite(row.vmag) ? ` (V ≈ ${row.vmag.toFixed(1)})` : '');

// results: [{ label, mjd, ok, rows, error, status }] one per blinked season (field-level answers);
// at: the ring. Matched locally, so one answer serves every click in the field. Always "predicts":
// these are JPL's orbit predictions, never something SPHEREx is known to have recorded.
export function decideAsteroid(results, at) {
  const near = [];
  for (const r of results) if (r.ok) for (const row of r.rows) if (asteroidHit(row, at)) near.push({ row, r });
  const what = ({ row, r }) => `JPL predicts ${bodyWord(row.name)} ${plainName(row.name)}${vText(row)} ${fmtArc(passDistance(row, at))} from here on ${fmtDay(r.mjd)}.`;
  const visible = near.find(n => !(Number.isFinite(n.row.vmag) && n.row.vmag > SPHEREX_VISIBLE_V));
  if (visible) {
    return { status: 'explained', hit: visible.row, season: visible.r,
      text: `${what(visible)} ${Number.isFinite(visible.row.vmag) ? 'It could be visible to SPHEREx' : 'JPL gives no brightness for it, so it might be visible to SPHEREx'}, so it may explain this dot.` };
  }
  const bad = results.filter(r => !r.ok);
  if (bad.length) {
    const why = bad[0].status === 404 ? 'the JPL lookup is not switched on in this copy of the app yet (HTTP 404)'
      : bad[0].status ? `JPL answered HTTP ${bad[0].status}` : `JPL did not answer (${bad[0].error || 'no reply'})`;
    return { status: 'failed', text: `Could not ask JPL: ${why}.`, reason: why };
  }
  if (near.length) {
    const f = near.slice().sort((a, b) => passDistance(a.row, at) - passDistance(b.row, at))[0];
    return { status: 'clear', faint: f.row, season: f.r,
      text: `${what(f)} It is ${f.row.vmag >= SPHEREX_VISIBLE_V + 2 ? 'far ' : ''}too faint for SPHEREx to see, so it doesn't explain this dot.` };
  }
  return { status: 'clear', text: 'No known Solar System object here on these dates.' };
}

// ---------------------------------------------------------------- Simple mode: plain-words twins
// Expert mode shows each check's full text (″, V magnitudes, orbit numbers); Simple shows these.
// '(2010 AB12)' -> '2010 AB12'; '433 Eros (A898 PA)' -> 'Eros' (the orbit number is Expert detail).
export function simpleBodyName(name) {
  const s = plainName(name);
  if (/^\d{4}\s+[A-Z]{2}\d*$/.test(s)) return s; // a provisional designation such as 2010 AB12
  const m = /^\d+\s+(?:\((.+)\)|([^(]+?)\s*(?:\(.*\))?)$/.exec(s); // '12345 (2001 XY)' -> '2001 XY'
  return m ? (m[1] || m[2]) : s;
}
// res: a check result as decideStar / decideAsteroid / evaluateFlags / decideSeasons return it.
export function plainCheckText(id, res) {
  if (!res) return '';
  if (id === 'star' && res.status === 'explained' && res.best) {
    const word = res.word || objectWord(res.best);
    if (res.part) return `Your ring is on the glow of ${res.best.name}, a catalogued ${word}, not on a dot of its own.`;
    return res.mover ? `${res.best.name}, a catalogued ${word} that moves, lands on your ring in one of the seasons.`
      : `${starLabel(res.best)}, a catalogued ${word}, sits right here and barely moves.${res.rival ? ` ${res.rival.name}, which moves, is predicted further away.` : ''}`;
  }
  if (id === 'asteroid' && (res.hit || res.faint)) {
    const row = res.hit || res.faint, what = `JPL predicts ${bodyWord(row.name)} ${simpleBodyName(row.name)} passes your ring on ${fmtDay(res.season.mjd)}`;
    return res.hit ? `${what}, and it may be bright enough for SPHEREx to see.` : `${what}, but it is too faint for SPHEREx to see.`;
  }
  return res.text || '';
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
  // A dot is its own peak: no neighbour brighter and none masked. On the glow of a brighter source the
  // brightest pixel near the ring is just its wing (E2E, Sun 15 Nov: empty sky beside RW Aur and the
  // edge of R Dra read as "present in 3 of 3 seasons").
  if (!isPeak(stack, bx, by)) return null;
  const c = centroid(stack, bx, by, 2);
  if (!c || !(c.snr >= minSnr) || Math.hypot(c.x - x, c.y - y) > search + 0.5) return null;
  return { x: c.x, y: c.y, snr: c.snr };
}

// The dot you clicked (judging panel A4): the NEAREST local peak to the click within the search
// radius that stands 5× above the noise, and its measured centre; null if the click is on no dot.
// (detectNear above takes the brightest pixel nearby, right for "is anything here", but next to a
// brighter neighbour it would answer for the neighbour.)
export function dotAt(stack, x, y, { search = DETECT_SEARCH_PX, minSnr = DETECT_MIN_SNR } = {}) {
  const n = stack.n, peaks = [];
  for (let j = Math.floor(y - search); j <= Math.ceil(y + search); j++) for (let i = Math.floor(x - search); i <= Math.ceil(x + search); i++) {
    if (i < 0 || j < 0 || i >= n || j >= n || Math.hypot(i - x, j - y) > search || !Number.isFinite(stack.data[j * n + i])) continue;
    if (isPeak(stack, i, j)) peaks.push([i, j]);
  }
  peaks.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y));
  for (const [i, j] of peaks) {
    // its own centre: the 3 × 3 pixels around the peak (PSF ~1 px), so a neighbour's wing 2 px away
    // does not pull it; a centre that still drifts off its peak pixel falls back to the peak itself
    const c = centroid(stack, i, j, 1.5, 1);
    if (!c || !(c.snr >= minSnr)) continue;
    const [cx, cy] = Math.hypot(c.x - i, c.y - j) <= 0.75 ? [c.x, c.y] : [i, j];
    if (Math.hypot(cx - x, cy - y) <= search + 0.5) return { x: cx, y: cy, snr: c.snr };
  }
  return null;
}

function isPeak(stack, x, y) {
  const n = stack.n, v = stack.data[y * n + x];
  for (let j = y - 1; j <= y + 1; j++) for (let i = x - 1; i <= x + 1; i++) {
    if ((i === x && j === y) || i < 0 || j < 0 || i >= n || j >= n) continue;
    const w = stack.data[j * n + i];
    if (!Number.isFinite(w) || w > v) return false;
  }
  return true;
}
// Walk uphill from (x, y) to the top of whatever the spot sits on (masked pixels count as the top:
// a saturated core). Returns { x, y } of that top, or null if (x, y) is already a peak.
// Full function test (Sun 15 Nov): with no distance cap the walk reached a bright star 80″ away from
// almost any empty-sky click. A star's light only spreads a few pixels (SPHEREx PSF ~6″ = 1 px, wings
// to ~3 px), so the walk stops at GLOW_MAX_PX: a top further away does not explain this spot.
export const GLOW_MAX_PX = 3;
export function glowSource(stack, x, y, maxPx = GLOW_MAX_PX) {
  const n = stack.n, x0 = Math.round(x), y0 = Math.round(y); let cx = x0, cy = y0, moved = false;
  for (let step = 0; step < 4 * n; step++) {
    if (Math.hypot(cx - x0, cy - y0) > maxPx + 0.5) return null;
    const v = stack.data[cy * n + cx]; let bx = cx, by = cy, bv = v, masked = false;
    for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n || (i === cx && j === cy)) continue;
      const w = stack.data[j * n + i];
      if (!Number.isFinite(w)) { masked = true; bx = i; by = j; break; }
      if (w > bv) { bv = w; bx = i; by = j; }
    }
    if (bx === cx && by === cy) break;
    cx = bx; cy = by; moved = true; if (masked) break;
  }
  return moved && Math.hypot(cx - x0, cy - y0) <= maxPx + 0.5 ? { x: cx, y: cy } : null;
}
// The stack's sky level and noise: median and 1.4826 × median absolute deviation of its finite pixels.
export function skyNoise(stack) {
  const v = Array.from(stack.data).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return { sky: 0, sigma: Infinity };
  const med = v[v.length >> 1], dev = v.map(x => Math.abs(x - med)).sort((a, b) => a - b);
  return { sky: med, sigma: 1.4826 * dev[dev.length >> 1] || 1e-9 };
}

// The top of the glow a click sits on when it is not on a dot of its own (Master's rule: walk uphill
// to the local peak): only when the light at the click is above the sky noise (else "Nothing here"),
// and within GLOW_MAX_PX (the PSF wings). Returns { x, y, part: true } or null.
export function wingPeak(stack, x, y) {
  const n = stack.n, { sky, sigma } = skyNoise(stack), v = stack.data[Math.round(y) * n + Math.round(x)];
  if (!(Number.isFinite(v) && v >= sky + 3 * sigma)) return null;
  const g = glowSource(stack, x, y); if (!g) return null;
  const c = Number.isFinite(stack.data[g.y * n + g.x]) ? centroid(stack, g.x, g.y, 1.5) : null;
  return c && Math.hypot(c.x - g.x, c.y - g.y) < 1 ? { x: c.x, y: c.y, part: true } : { x: g.x, y: g.y, part: true };
}
// Is the source at b a SEPARATE peak from the dot at a (Master's rule)? Yes when b has its own maximum
// (a local peak within one pixel of b, 5× above the noise, not a's own peak pixel) and the light along
// the line between them dips at least 3× the noise below both peaks: a real saddle. Grid coordinates.
export function separatePeaks(stack, a, b) {
  const n = stack.n, val = (i, j) => (i < 0 || j < 0 || i >= n || j >= n ? NaN : stack.data[j * n + i]);
  const { sky, sigma } = skyNoise(stack);
  const ai = Math.round(a.x), aj = Math.round(a.y);
  let bi = -1, bj = -1, bv = -Infinity;
  for (let j = Math.round(b.y) - 1; j <= Math.round(b.y) + 1; j++) for (let i = Math.round(b.x) - 1; i <= Math.round(b.x) + 1; i++) {
    const v = val(i, j); if (Number.isFinite(v) && v > bv) { bv = v; bi = i; bj = j; }
  }
  if (bi < 0 || (bi === ai && bj === aj) || !isPeak(stack, bi, bj) || bv < sky + 5 * sigma) return false;
  const av = val(ai, aj), steps = Math.max(2, Math.ceil(Math.hypot(bi - ai, bj - aj) * 4));
  let low = Infinity;
  for (let k = 1; k < steps; k++) {
    const i = Math.round(ai + (bi - ai) * k / steps), j = Math.round(aj + (bj - aj) * k / steps);
    if ((i === ai && j === aj) || (i === bi && j === bj)) continue;
    const v = val(i, j); if (Number.isFinite(v)) low = Math.min(low, v);
  }
  return Number.isFinite(low) && low <= Math.min(av, bv) - 3 * sigma;
}

// stacks: [{ label, n, data }]; pointsFor(k): candidate grid positions in season k (the ring, plus a
// known mover's predicted place). Returns { per: [{ label, found }], k, N }.
export function seasonPresence(stacks, pointsFor) {
  const per = stacks.map((s, i) => {
    let found = null;
    const pts = pointsFor(i);
    for (const [x, y] of pts) { const d = detectNear(s, x, y); if (d && (!found || d.snr > found.snr)) found = d; }
    // no dot: is the ring on the glow of a brighter source more than the search radius away?
    // no dot: is there light above the noise at the ring at all ("nothing here" if not), and if so does it
    // climb to a brighter source within the PSF wings (GLOW_MAX_PX)?
    let glow = null, quiet = false;
    if (!found && pts.length) {
      const [x, y] = pts[0], { sky, sigma } = skyNoise(s), at = s.data[Math.round(y) * s.n + Math.round(x)];
      quiet = Number.isFinite(at) && at < sky + 3 * sigma;
      const g = quiet ? null : glowSource(s, x, y);
      if (g && Math.hypot(g.x - x, g.y - y) > DETECT_SEARCH_PX) glow = { ...g, arcsec: Math.hypot(g.x - x, g.y - y) * PIXEL_ARCSEC };
    }
    return { label: s.label, found, glow, quiet };
  });
  return { per, k: per.filter(p => p.found).length, N: per.length };
}
export function decideSeasons(pres) {
  const { k, N } = pres;
  if (k >= 2) return { status: 'clear', ...pres, text: `Present in ${k} of ${N} seasons.` };
  const glows = pres.per.filter(p => !p.found && p.glow), g = glows.length > pres.per.length / 2 ? glows[0].glow : null;
  const glowTxt = g ? ` The ring sits on the glow of a brighter source about ${Math.round(g.arcsec)}″ away, not on a separate dot.` : '';
  // nothing above the noise in most seasons: there is simply nothing here
  const nothing = !g && k === 0 && pres.per.filter(p => p.quiet).length > pres.per.length / 2;
  if (nothing) return { status: 'explained', ...pres, glow: false, nothing: true,
    text: `No dot stands out from the noise here in any of the ${N} seasons.`, reason: 'no dot stands out from the noise here' };
  return { status: 'explained', ...pres, glow: !!g,
    text: (k === 1 ? `Seen as a clear dot in only 1 of ${N} seasons.` : `Not a clear dot in any of the ${N} seasons.`) + glowTxt,
    reason: g ? `the ring sits on the glow of a brighter source about ${Math.round(g.arcsec)}″ away` : k === 1 ? `it shows as a clear dot in only 1 of ${N} seasons` : `it is not a clear dot in any of the ${N} seasons` };
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
  return { lines: CHECKS.map(c => ({ id: c.id, status: 'pending', text: '', data: null })) };
}
// The checks run in parallel (lead, after the Design run: never queue the quick checks behind JPL).
// Actions: { type: 'start' } (every line checking) · { type: 'done', id, status, text, data } (any line
// still checking) · { type: 'retry', id } (a line that could not check runs again; others keep results).
export function checklistStep(state, action) {
  const lines = state.lines.map(l => ({ ...l }));
  const i = lines.findIndex(l => l.id === action.id);
  if (action.type === 'start') return { lines: initChecklist().lines.map(l => ({ ...l, status: 'checking' })) };
  if (action.type === 'done') {
    if (i < 0 || lines[i].status !== 'checking' || !['clear', 'explained', 'failed'].includes(action.status)) return state;
    lines[i] = { ...lines[i], status: action.status, text: action.text || '', data: action.data ?? null };
    return { lines };
  }
  if (action.type === 'retry') {
    if (i < 0 || lines[i].status !== 'failed') return state;
    lines[i] = { ...lines[i], status: 'checking', text: '', data: null };
    return { lines };
  }
  return state;
}
const isDone = (l) => ['clear', 'explained', 'failed'].includes(l.status);
export const isFinished = (state) => state.lines.every(isDone);

// ---------------------------------------------------------------- verdict
// Spec order (DESIGN.md 34): Known star · Likely artefact · Known asteroid · Unexplained.
// A check that EXPLAINS the suspect decides the verdict even when another check could not run
// (the missing check could not undo that explanation); "Unexplained" needs all four clear;
// with no explanation and a check that could not run, there is no verdict.
export function decideVerdict(state) {
  const by = Object.fromEntries(state.lines.map(l => [l.id, l]));
  const failed = state.lines.filter(l => l.status === 'failed').map(l => l.id);
  // checks still running when the answer is already decided (shown as "… still running · Ns")
  const running = state.lines.filter(l => !isDone(l)).map(l => l.id);
  const notRun = failed.length ? `The ${failed.map(id => `"${checkTitle(id)}"`).join(' and ')} check could not run; it would not change this answer.` : null;
  const decided = (v) => ({ ...v, running });
  if (by.star.status === 'explained') {
    const b = by.star.data?.best, mover = by.star.data?.mover;
    const name = b?.name || 'a catalogued star', word = by.star.data?.word || (b ? objectWord(b) : 'star');
    // a still entry is named with its Gaia G magnitude: "Known still star · Gaia DR3 …, G 16.3"
    if (by.star.data?.part) { // Master's rule: the ring is on a catalogued star's glow
      return decided({ kind: 'known-star', part: true, title: 'Not a separate dot', sub: `part of ${name}`,
        body: [`This spot is the outer glow of ${name}, a catalogued ${word}, not an object of its own.`, 'A star\'s light spreads a pixel or two around its centre; the ring sits on that spread.'],
        evidence: [by.star.text], notRun, decidedBy: 'star' });
    }
    return decided({ kind: 'known-star', still: !mover, title: mover ? `Known ${word}` : `Known still ${word}`, sub: mover ? 'moving as expected' : (b ? starLabel(b) : ''),
      body: mover ? [`This is ${name}, a ${word} known to move this much.`, 'You found it by eye: that is exactly how it is done.']
        : [`This is ${b ? starLabel(b) : name}, a catalogued ${word} that does not move between these seasons.`, 'Its catalogued motion is too small to shift it between these seasons, so a change you saw is in brightness, not position.'],
      evidence: [by.star.text], notRun, decidedBy: 'star' });
  }
  if (!isDone(by.star)) return { kind: 'pending' };
  if (by.asteroid.status === 'explained') {
    const h = by.asteroid.data?.hit;
    return decided({ kind: 'known-asteroid', title: isComet(h?.name) ? 'Known comet' : 'Known asteroid', sub: 'passing through',
      body: [`This is ${h?.name || 'a known Solar System object'}, a known ${isComet(h?.name) ? 'comet' : 'asteroid'}, passing through.`, 'JPL\'s orbit list predicts it at this spot on this date.'],
      evidence: [by.asteroid.text], notRun, decidedBy: 'asteroid' });
  }
  const why = [];
  if (by.flags.status === 'explained') why.push(by.flags.text);
  if (by.seasons.status === 'explained') why.push(by.seasons.text);
  const fp = by.flags.status === 'explained' ? [] : (by.flags.data?.per || []).filter(p => p.flagged);
  if (why.length && fp.length) why.push(`The archive also flags this spot in ${fp.map(p => `${p.flagged} of ${p.n} images of the ${p.label.toLowerCase()}`).join(' and ')}.`);
  if (why.length) {
    const onGlow = by.seasons.status === 'explained' && by.seasons.data?.glow;
    if (by.seasons.status === 'explained' && by.seasons.data?.nothing && by.flags.status !== 'explained') {
      return decided({ kind: 'nothing', title: 'Nothing here', sub: '', body: ['No dot stands out from the noise at this spot.', 'Pick a spot where you can see a dot in at least one of the two seasons.'],
        evidence: why, notRun, decidedBy: 'seasons' });
    }
    return decided({ kind: 'artefact', title: onGlow ? 'Not a separate dot' : 'Likely artefact', sub: '',
      body: onGlow ? ['This spot is the outer glow of a brighter source nearby, not an object of its own.', 'Here is why.'] : ['This is most likely not a real object.', 'Here is why.'],
      evidence: why, notRun, decidedBy: by.flags.status === 'explained' ? 'flags' : 'seasons' });
  }
  if (running.length) return { kind: 'pending', running }; // "Unexplained" waits for every check
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
// the two releases the app queries (web/data/releases.json; QR2 is not used)
export const DOIS = 'IRSA SPHEREx Data Release 1 (DOI 10.26131/IRSA678) and Quick Release 3 (DOI 10.26131/IRSA662)';
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
