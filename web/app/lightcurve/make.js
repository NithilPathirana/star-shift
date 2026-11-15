// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// "Make a light curve" (judges' suggestion B, design/spec-judge-suggestions.md): pure logic, no DOM.
// The visitor picks a source, the bands, the aperture and comparison stars; we measure it with the
// Proof page's method (logic.js / tools/make_proof.mjs) and, when comparison stars are chosen, take
// out what they share (differential photometry).
//  - Photometry: align.js centroid(…, 1 pass) at the source's predicted grid position: the sum of
//    background-subtracted pixels inside the aperture, background = median of a ring r+2 to r+5 px.
//    An image with any masked pixel in the aperture (the archive blanks saturated and bad pixels)
//    is "masked" and never measured; when every image is masked the source is too bright (saturated).
//    An image whose sum is under 3 times its noise is a non-detection there and is not plotted; a band
//    whose light is not the source's (the Brightness-over-time panel's rule, logic.js detection) plots nothing.
//  - Δm: each image only against first-season images of the same band, the same detector and the
//    same wavelength (±0.05 µm), Δm = −2.5 log10(F / mean F_ref): SPHEREx sees a different wavelength
//    in every image, so raw fluxes from different images cannot be lined up.
//  - Comparison stars: each one gets its own Δm the same way; their mean in an image is the part of
//    the change the stars share (calibration, background) and is subtracted. With no comparison
//    stars and "skip flagged" off, the numbers are exactly the Proof page's.
//  - Error bars: background noise in the aperture only (σ_bg √(N_ap (1 + N_ap/N_ring))), carried
//    through the reference mean and the comparison correction. The star's own photon noise is not
//    included (the images are in MJy/sr, without the detector gain), so the bars are a lower bound.
//  - Period search: the generalised Lomb–Scargle periodogram (Zechmeister & Kürster 2009, A&A 496,
//    577) with its analytic false-alarm probability; a period is only named inside the range the
//    sampling supports.

import { centroid, worldToGrid } from '../../core/align.js';
import { propagate, separationArcsec } from '../../core/motion.js';
import { classifyFrame } from '../../core/contam.js';
import { meanSem } from '../proof/logic.js';
import { seasonBounds } from '../seasons.js';
import { GROUPS, APERTURE, WL_MATCH, GRID_ARCSEC, SEASON_GAP, DET, toMilliJy, seasonIndex, detection } from './logic.js';

// Detector wavelength ranges (SPHEREx Explanatory Supplement v2.0, as the band editor in ui.js).
export const DET_UM = [[0.744, 1.116], [1.099, 1.651], [1.636, 2.421], [2.423, 3.822], [3.809, 4.420], [4.412, 5.002]];
// Okabe–Ito colours (colour-blind safe), readable on the dark chart plate.
export const PALETTE = ['#56B4E9', '#E69F00', '#009E73', '#F0E442', '#CC79A7', '#D55E00'];
export const APERTURES = [1.5, 2, 2.5, 3, 3.5]; // px (×6.15″)
export const MAX_COMPS = 3;
export const PERIOD_CAVEAT = "SPHEREx visits a spot roughly every 6 months, so periods shorter than ~1 year can't be found; this shows what the data can and can't say.";
export const SATURATED_TEXT = 'Saturated: not measurable.';
export const NOTHING_TEXT = 'Nothing detected at this spot.';
export const DETECT_SIGMA = 3; // an image whose aperture sum is under 3 times its noise is a non-detection there
// Proof's rounding (tools/make_proof.mjs): season means to 0.001 mag, then last minus first, σ to 0.1
const r3 = (v) => +v.toFixed(3), r1 = (v) => +v.toFixed(1);
export const ERR_NOTE = "Error bars: background noise in the aperture only. The star's own photon noise and calibration drifts are not included, so they are a lower bound; choose comparison stars to add their measured scatter.";
export const ERR_NOTE_COMP = 'Error bars: background noise in the aperture plus the scatter of the comparison stars about each other (how much a steady star spreads in this band).';
const F = 2.5 / Math.LN10; // 1.0857: σ_m = F σ_F / F

// Band sets the visitor can choose. Each band says which images belong to it (by detector or wavelength).
export function bandSet(kind, ranges = []) {
  if (kind === 'dets') return DET_UM.map((r, k) => ({ id: `d${k + 1}`, name: `Detector ${k + 1}`, long: `Detector ${k + 1} (${r[0].toFixed(2)}–${r[1].toFixed(2)} µm)`, colour: PALETTE[k], dets: [k + 1] }));
  if (kind === 'ranges') return (ranges || []).filter(r => Number.isFinite(r.min) && Number.isFinite(r.max) && r.max > r.min)
    .map((r, k) => ({ id: `r${k}`, name: String(r.name || `Range ${k + 1}`), long: `${r.name || `Range ${k + 1}`} (${(+r.min).toFixed(2)}–${(+r.max).toFixed(2)} µm)`, colour: r.c || PALETTE[k % PALETTE.length], min: +r.min, max: +r.max }));
  return GROUPS.map((g, k) => ({ id: g.id, name: g.name, long: g.long, colour: PALETTE[k], dets: g.dets })); // 'proof'
}
export const inBand = (b, r) => (b.dets ? b.dets.includes(r.det) : Number.isFinite(r.wl) && r.wl >= b.min && r.wl < b.max);

// Grid position of a source on one image: the viewer's own target position (f.expected), or a sky
// position moved by its proper motion to the image's date.
export function sourceAt(src, f, grid) {
  if (!src || src.own) return f.expected || [grid.c, grid.c];
  const p = (src.pmra || src.pmdec) ? propagate({ ra: src.ra, dec: src.dec, pmra: src.pmra, pmdec: src.pmdec, epoch: src.epoch ?? 2016.0 }, f.mjd) : src;
  return worldToGrid(grid, p.ra, p.dec);
}

// Aperture photometry of one position on one image.
export function phot(f, x0, y0, r = APERTURE) {
  let masked = 0, inside = 0, ring = 0;
  const R1 = r + 2, R2 = r + 5;
  for (let j = Math.floor(y0 - R2); j <= Math.ceil(y0 + R2); j++) for (let i = Math.floor(x0 - R2); i <= Math.ceil(x0 + R2); i++) {
    if (i < 0 || j < 0 || i >= f.n || j >= f.n) continue;
    const d = Math.hypot(i - x0, j - y0), v = f.data[j * f.n + i];
    if (d <= r) { inside++; if (!Number.isFinite(v)) masked++; } else if (d > R1 && d <= R2 && Number.isFinite(v)) ring++;
  }
  const edge = !(x0 - r >= -0.5 && y0 - r >= -0.5 && x0 + r <= f.n - 0.5 && y0 + r <= f.n - 0.5); // the aperture runs off the image
  const cen = masked || edge ? null : centroid(f, x0, y0, r, 1); // the Proof page's call
  const flux = cen?.flux ?? null;
  const fluxErr = cen && Number.isFinite(cen.sigma) && ring ? cen.sigma * Math.sqrt(inside * (1 + inside / ring)) : null;
  let flagged = false, why = [], sat = false;
  if (f.flags && f.flagNames) { const c = classifyFrame({ flags: f.flags, flagNames: f.flagNames, n: f.n, cx: x0, cy: y0, glow: f.glow }, r); why = c.reasons; flagged = why.length > 0; sat = c.saturated; }
  return { masked, inside, edge, flux, fluxErr, snr: cen?.snr ?? null, flagged, why, sat }; // sat: OVERFLOW/BLOOM on these pixels
}

// Is a comparison measurement usable in this image?
const clean = (p, skipFlagged) => p && !p.masked && !p.sat && !p.edge && p.flux > 0 && p.snr > 5 && !(skipFlagged && p.flagged); // detected (S/N above 5), as the motion fit

// One light curve. frames: the viewer's raw frames; choices: { source, comps: [star], aperture,
// bands, skipFlagged }; bounds: the viewer's seasons (seasons.js).
export function makeCurve(frames, grid, choices = {}, bounds) {
  const { source = { own: true }, comps = [], aperture = APERTURE, skipFlagged = true } = choices;
  const bands = choices.bands || bandSet('proof');
  const B = bounds?.length ? bounds : seasonBounds(frames.map(f => f.mjd), SEASON_GAP);
  const season = seasonIndex(frames.map(f => f.mjd), B);
  const rows = frames.map((f, idx) => {
    const [x, y] = sourceAt(source, f, grid);
    const t = phot(f, x, y, aperture);
    const cs = comps.map(c => { const [cx, cy] = sourceAt(c, f, grid); return phot(f, cx, cy, aperture); });
    // where the light really is (the Brightness-over-time panel's rule, logic.js detection: motion-fit settings)
    const lc = t.masked || t.edge ? null : centroid(f, x, y, DET.radius);
    const below = !(t.flux > 0) || (t.fluxErr > 0 && t.flux < DETECT_SIGMA * t.fluxErr);
    const status = t.masked ? 'masked' : t.edge ? 'off image' : skipFlagged && t.flagged ? 'flagged' : below || !Number.isFinite(f.wavelengthUm) ? 'faint' : 'usable';
    return { idx, mjd: f.mjd, det: f.detector, wl: f.wavelengthUm, s: season[idx], pix: f.pixArcsec ?? grid?.scale ?? GRID_ARCSEC, at: [x, y], t, cs, status,
      masked: t.masked, light: lc ? [lc.x, lc.y] : null, snr: lc ? lc.snr : null };
  });
  const outBands = bands.map(b => {
    const mine = rows.filter(r => inBand(b, r));
    // not the source's light (the panel's a3 rule, same function): no light above the noise there, or the light is
    // centred on another source. Then nothing is plotted for this band and no change is reported.
    const detect = detection(mine), absent = !!detect && detect.state !== 'ok';
    const usable = absent ? [] : mine.filter(r => r.status === 'usable');
    const firstS = usable.length ? Math.min(...usable.map(r => r.s)) : -1;
    const first = usable.filter(r => r.s === firstS);
    const refOf = (r, ok) => first.filter(q => q !== r && q.det === r.det && Math.abs(q.wl - r.wl) <= WL_MATCH && ok(q));
    const points = [], why = new Map();
    // each comparison star's own Δm in image r (against its own first-season same-wavelength images)
    const dsFor = (r) => {
      const ds = [];
      comps.forEach((c, k) => {
        if (!clean(r.cs[k], skipFlagged)) return;
        const cref = refOf(r, q => clean(q.cs[k], skipFlagged));
        if (!cref.length) return;
        const cf = cref.reduce((a, q) => a + q.cs[k].flux, 0) / cref.length;
        const ce = Math.sqrt(cref.reduce((a, q) => a + (q.cs[k].fluxErr ?? 0) ** 2, 0)) / cref.length;
        ds.push({ d: -2.5 * Math.log10(r.cs[k].flux / cf), e: F * Math.hypot((r.cs[k].fluxErr ?? 0) / r.cs[k].flux, ce / cf) });
      });
      return ds;
    };
    // a band where no chosen comparison star can be measured in any image cannot be differential: it is
    // measured directly (as Proof) and labelled so ('direct'), never silently mixed
    const useComps = comps.length > 0 && usable.some(r => refOf(r, () => true).length && dsFor(r).length);
    for (const r of usable) {
      const ref = refOf(r, () => true);
      if (!ref.length) { why.set(r.idx, 'no reference'); continue; }
      const refFlux = ref.reduce((a, q) => a + q.t.flux, 0) / ref.length;
      const refErr = Math.sqrt(ref.reduce((a, q) => a + (q.t.fluxErr ?? 0) ** 2, 0)) / ref.length;
      const dmT = -2.5 * Math.log10(r.t.flux / refFlux);
      let errT = r.t.fluxErr != null ? F * Math.hypot(r.t.fluxErr / r.t.flux, refErr / refFlux) : null;
      let corr = 0, corrErr = 0, nComp = 0, ds = null;
      if (useComps) {
        ds = dsFor(r);
        if (!ds.length) { why.set(r.idx, 'no comparison'); continue; }
        nComp = ds.length;
        corr = ds.reduce((a, x) => a + x.d, 0) / nComp;
        corrErr = Math.sqrt(ds.reduce((a, x) => a + x.e ** 2, 0)) / nComp;
      }
      if (errT != null) errT = Math.hypot(errT, corrErr);
      points.push({ idx: r.idx, mjd: r.mjd, s: r.s, det: r.det, wl: r.wl, mJy: toMilliJy(r.t.flux, r.pix), mJyErr: r.t.fluxErr != null ? toMilliJy(r.t.fluxErr, r.pix) : null,
        dm: dmT - corr, err: errT, nComp, corr, ds });
    }
    // empirical floor: how much the comparison stars scatter about their own mean (a steady star's spread here)
    let compScatter = null;
    if (useComps) {
      const res = [];
      for (const p of points) {
        const ds = p.ds || [];
        for (let k = 0; k < ds.length; k++) {
          const others = ds.filter((_, j) => j !== k);
          res.push(ds[k].d - (others.length ? others.reduce((a, x) => a + x.d, 0) / others.length : 0));
        }
      }
      if (res.length >= 3) compScatter = Math.sqrt(res.reduce((a, v) => a + v * v, 0) / res.length);
      if (compScatter != null) for (const p of points) if (p.err != null) p.err = Math.hypot(p.err, compScatter);
    }
    const bySeason = [...new Set(points.map(p => p.s))].sort((a, b) => a - b).map(s => {
      const ps = points.filter(p => p.s === s), ms = meanSem(ps.map(p => p.dm));
      return { season: s, n: ms.n, dm: ms.mean, sem: ms.sem, from: Math.min(...ps.map(p => p.mjd)), to: Math.max(...ps.map(p => p.mjd)) };
    });
    const a = bySeason[0], z = bySeason[bySeason.length - 1];
    const ok = bySeason.length >= 2 && a.season === firstS && a.n >= 3 && z.n >= 3 && a.sem != null && z.sem != null;
    const count = st => mine.filter(r => r.status === st).length;
    const dmag = ok ? r3(r3(z.dm) - r3(a.dm)) : null, dmagErr = ok ? r3(Math.hypot(r3(a.sem), r3(z.sem))) : null;
    return { ...b, total: mine.length, masked: count('masked'), flagged: absent ? 0 : count('flagged'), faint: absent && detect.state === 'offset' ? 0 : absent ? count('usable') + count('faint') + count('off image') : count('faint') + count('off image'),
      detect, absent, notHere: absent && detect.state === 'offset' ? count('usable') + count('faint') : 0,
      noRef: [...why.values()].filter(w => w === 'no reference').length, noComp: [...why.values()].filter(w => w === 'no comparison').length, why,
      points, compScatter, direct: comps.length > 0 && !useComps, bySeason, ok, dmag, dmagErr, sigma: ok && dmagErr > 0 ? r1(Math.abs(dmag) / dmagErr) : null };
  });
  const inAny = rows.filter(r => outBands.some(b => inBand(b, r)));
  const counts = { total: inAny.length, masked: inAny.filter(r => r.status === 'masked').length, flagged: inAny.filter(r => r.status === 'flagged').length,
    plotted: outBands.reduce((a, b) => a + b.points.length, 0) };
  // every image masked within the aperture: too bright for SPHEREx (Proof's one meaning of "saturated")
  const status = !inAny.length ? 'empty' : counts.masked === inAny.length ? 'saturated' : counts.plotted ? 'ok'
    : outBands.every(b => !b.total || b.absent || !b.points.length) && outBands.some(b => b.absent || b.faint) ? 'nothing' : 'none';
  return { rows, bands: outBands, counts, status, choices: { aperture, skipFlagged, nComps: comps.length } };
}

// "64 of 120 images plotted · 16 skipped: a masked pixel within 15″ · 3 flagged at the source · …"
export function countsText(c) {
  const sum = (k) => c.bands.reduce((a, b) => a + (b[k] || 0), 0);
  const ap = Math.round(c.choices.aperture * GRID_ARCSEC);
  const parts = [`${c.counts.plotted} of ${c.counts.total} images plotted`, `${c.counts.masked} skipped: a masked pixel within ${ap}″`];
  if (c.choices.skipFlagged) parts.push(`${c.counts.flagged} flagged at the source`);
  const nr = sum('noRef'), nc = sum('noComp'), fa = sum('faint'), nh = sum('notHere');
  if (nr) parts.push(`${nr} with no first-season image at the same wavelength`);
  if (nc) parts.push(`${nc} with no usable comparison star`);
  if (fa) parts.push(`${fa} with no light above the noise`);
  if (nh) parts.push(`${nh} where the light is not the source's`);
  return parts.join(' · ');
}

// ---- comparison stars ----
// Gaia rows -> up to `max` stars that are clean (no masked pixel, no flag, measurable) in at least
// `minClean` of the images (an image where a star is not clean never uses it), isolated, and far enough from the source that their
// background rings do not touch its aperture. Ranked by median S/N (best-measured first).
export function comparisonCandidates(stars, frames, grid, { source = { own: true }, aperture = APERTURE, gMax = 19.5, minClean = 0.5, limit = 40 } = {}) {
  if (!frames.length || !grid) return [];
  const mid = frames[Math.floor(frames.length / 2)];
  const [sx, sy] = sourceAt(source, mid, grid);
  const margin = aperture + 1, minSep = aperture + 4; // aperture on the image; clear of the source's light (its PSF is ~1 px)
  const placed = (stars || []).filter(s => Number.isFinite(s.ra) && Number.isFinite(s.dec) && Number.isFinite(s.g))
    .map(s => { const [x, y] = sourceAt(s, mid, grid); return { ...s, x, y }; });
  const cands = placed.filter(s => s.g <= gMax && s.x >= margin && s.y >= margin && s.x <= grid.n - 1 - margin && s.y <= grid.n - 1 - margin
      && Math.hypot(s.x - sx, s.y - sy) >= minSep
      && !placed.some(o => o !== s && o.g < s.g + 2 && Math.hypot(o.x - s.x, o.y - s.y) <= aperture + 1))
    .sort((a, b) => a.g - b.g).slice(0, limit);
  const out = [];
  for (const s of cands) {
    let good = 0, sat = 0; const snr = [];
    for (const f of frames) {
      const [x, y] = sourceAt(s, f, grid), p = phot(f, x, y, aperture);
      if (p.sat) sat++;
      if (clean(p, true)) { good++; snr.push(p.snr); }
    }
    snr.sort((a, b) => a - b);
    const med = snr.length ? snr[snr.length >> 1] : 0;
    out.push({ id: s.id, ra: s.ra, dec: s.dec, pmra: s.pmra || 0, pmdec: s.pmdec || 0, epoch: s.epoch ?? 2016.0, g: s.g,
      sepArcsec: Math.hypot(s.x - sx, s.y - sy) * grid.scale, clean: good, satFlag: sat, of: frames.length, snr: med, eligible: good >= minClean * frames.length });
  }
  return out.sort((a, b) => (b.eligible - a.eligible) || (b.snr - a.snr));
}
export const autoPick = (cands, max = MAX_COMPS) => cands.filter(c => c.eligible).slice(0, max);

// ---- period search ----
// Generalised Lomb–Scargle (floating mean, weights 1/σ²). Returns normalised power p ∈ [0, 1] per frequency (1/day).
export function lombScargle(t, y, dy, freqs) {
  const n = t.length;
  const w0 = t.map((_, i) => (dy && dy[i] > 0 ? 1 / dy[i] ** 2 : 1)), W = w0.reduce((a, v) => a + v, 0), w = w0.map(v => v / W);
  const Y = w.reduce((a, v, i) => a + v * y[i], 0);
  const YYh = w.reduce((a, v, i) => a + v * y[i] * y[i], 0) - Y * Y;
  return freqs.map(f => {
    const om = 2 * Math.PI * f;
    let C = 0, S = 0, YC = 0, YS = 0, CC = 0, CS = 0;
    for (let i = 0; i < n; i++) {
      const c = Math.cos(om * t[i]), s = Math.sin(om * t[i]), wi = w[i];
      C += wi * c; S += wi * s; YC += wi * y[i] * c; YS += wi * y[i] * s; CC += wi * c * c; CS += wi * c * s;
    }
    const SS = 1 - CC;
    const YCh = YC - Y * C, YSh = YS - Y * S, CCh = CC - C * C, SSh = SS - S * S, CSh = CS - C * S;
    const D = CCh * SSh - CSh * CSh;
    return D > 0 && YYh > 0 ? (SSh * YCh * YCh + CCh * YSh * YSh - 2 * CSh * YCh * YSh) / (YYh * D) : 0;
  });
}
// Analytic false-alarm probability of a peak of power p among M independent frequencies (Z&K eq. 24, Horne & Baliunas).
export const falseAlarm = (p, n, M) => { const single = Math.pow(Math.max(0, 1 - p), (n - 3) / 2); return Math.min(1, 1 - Math.pow(1 - single, Math.max(1, M))); };
// Power a peak needs for a given false-alarm probability.
export const powerAt = (fap, n, M) => 1 - Math.pow(1 - Math.pow(1 - fap, 1 / Math.max(1, M)), 2 / (n - 3));

// What periods can this sampling find? Baseline T must hold two cycles (P ≤ T/2); visits in bursts
// (gaps of 60+ days) alias anything shorter than twice the time between bursts; one continuous run
// is limited by twice its typical spacing.
export function periodRange(times) {
  const t = [...times].sort((a, b) => a - b), T = t.length ? t[t.length - 1] - t[0] : 0;
  const runs = []; let cur = [t[0]];
  for (let i = 1; i < t.length; i++) { if (t[i] - t[i - 1] >= SEASON_GAP) { runs.push(cur); cur = []; } cur.push(t[i]); }
  if (t.length) runs.push(cur);
  let pMin;
  if (runs.length >= 2) {
    const mids = runs.map(r => (r[0] + r[r.length - 1]) / 2), gaps = mids.slice(1).map((m, i) => m - mids[i]).sort((a, b) => a - b);
    pMin = 2 * gaps[gaps.length >> 1];
  } else {
    const d = t.slice(1).map((v, i) => v - t[i]).filter(v => v > 0).sort((a, b) => a - b);
    pMin = 2 * (d[d.length >> 1] || 1);
  }
  return { T, pMin, pMax: T / 2, visits: runs.length, ok: pMin <= T / 2 };
}

// Periodogram of points [{ mjd, dm, err }] with what it can claim. A best period is named only when
// it lies inside the supported range AND its false-alarm probability is under 1%.
export function periodSearch(points, { oversample = 10, minPeriod = 0.5 } = {}) {
  const pts = points.filter(p => Number.isFinite(p.mjd) && Number.isFinite(p.dm));
  const n = pts.length, rng = periodRange(pts.map(p => p.mjd));
  if (n < 8 || !(rng.T > 0)) return { n, range: rng, freqs: [], power: [], best: null, claim: null, why: 'too few images' };
  const fLo = 1 / (2 * rng.T), fHi = 1 / Math.max(minPeriod, Math.min(rng.pMin / 4, 30)); // plot from twice the baseline down to well below the limit
  const step = 1 / (oversample * rng.T), freqs = [];
  for (let f = fLo; f <= fHi + 1e-12 && freqs.length < 20000; f += step) freqs.push(f);
  const power = lombScargle(pts.map(p => p.mjd), pts.map(p => p.dm), pts.map(p => p.err), freqs);
  const M = Math.max(1, (fHi - fLo) * rng.T);
  let bi = 0; power.forEach((p, i) => { if (p > power[bi]) bi = i; });
  const best = { period: 1 / freqs[bi], power: power[bi], fap: falseAlarm(power[bi], n, M) };
  let si = -1; power.forEach((p, i) => { const P = 1 / freqs[i]; if (P >= rng.pMin && P <= rng.pMax && (si < 0 || p > power[si])) si = i; });
  const inRange = si >= 0 ? { period: 1 / freqs[si], power: power[si], fap: falseAlarm(power[si], n, M) } : null;
  const claim = inRange && inRange.fap < 0.01 ? inRange : null;
  const why = claim ? null : !rng.ok ? 'sampling' : 'no significant peak';
  return { n, range: rng, freqs, power, M, best, inRange, claim, why, level1: powerAt(0.01, n, M) };
}

// Plain-language verdict for the period search (never names a period the sampling cannot support).
export function periodText(ps) {
  const d = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
  if (ps.why === 'too few images') return `Too few plotted images (${ps.n}) to look for a period.`;
  if (ps.claim) return `Period ${d(ps.claim.period)} days (false-alarm probability ${(ps.claim.fap * 100).toFixed(2)}%), inside the range these dates can test (${d(ps.range.pMin)}–${d(ps.range.pMax)} days).`;
  if (ps.why === 'sampling') return `No period can be claimed: these images span ${d(ps.range.T)} days in ${ps.range.visits} visits, so the shortest period they could find (${d(ps.range.pMin)} days, twice the time between visits) is longer than the longest they could confirm (${d(ps.range.pMax)} days, half the time span). The highest peak (${d(ps.best.period)} days) is not a period these dates can support.`;
  return `No significant period between ${d(ps.range.pMin)} and ${d(ps.range.pMax)} days: the highest peak there has a false-alarm probability of ${(ps.inRange.fap * 100).toFixed(0)}% (a claim needs under 1%).`;
}

// ---- export and links ----
export const CSV_COLUMNS = ['source', 'band', 'date_utc', 'mjd', 'detector', 'wavelength_um', 'flux_mJy', 'flux_err_mJy', 'dmag', 'dmag_err', 'n_comparison', 'season', 'status'];
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const iso = (mjd) => new Date((mjd - 40587) * 864e5).toISOString().slice(0, 19) + 'Z';
// One row per image per band: plotted points with their numbers, the rest with why they were left out.
export function toCSV(curve, name = '') {
  const lines = [CSV_COLUMNS.join(',')];
  for (const b of curve.bands) for (const r of curve.rows) {
    if (!inBand(b, r)) continue;
    const p = b.points.find(q => q.idx === r.idx);
    const status = p ? 'plotted' : r.status !== 'usable' ? r.status : b.why.get(r.idx) || 'not plotted';
    lines.push([name, b.name, iso(r.mjd), r.mjd.toFixed(5), r.det, Number.isFinite(r.wl) ? r.wl.toFixed(4) : '',
      p ? p.mJy.toFixed(4) : '', p?.mJyErr != null ? p.mJyErr.toFixed(4) : '', p ? p.dm.toFixed(4) : '', p?.err != null ? p.err.toFixed(4) : '',
      p ? p.nComp : '', r.s + 1, status].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

// Choices <-> the "lc" link parameter: b=proof|dets|ranges; a=aperture px; f=1|0 skip flagged;
// c=comparison Gaia ids (numbers only, '-' for none); s=ra,dec of a clicked source (else the target).
export function encodeChoices({ bandKind = 'proof', aperture = APERTURE, skipFlagged = true, comps = null, source = null, period = false } = {}) {
  const p = [`b=${bandKind}`, `a=${aperture}`, `f=${skipFlagged ? 1 : 0}`];
  if (comps) p.push(`c=${comps.length ? comps.map(c => String(c.id || c).replace(/^Gaia DR3 /, '').replace(/\D/g, '')).join('.') : '-'}`);
  if (source && !source.own) p.push(`s=${source.ra.toFixed(5)},${source.dec.toFixed(5)}`);
  if (period) p.push('p=1');
  return p.join(';');
}
export function decodeChoices(s) {
  const o = {}; for (const kv of String(s || '').split(';')) { const [k, v] = kv.split('='); if (k) o[k] = v ?? ''; }
  const out = { bandKind: ['proof', 'dets', 'ranges'].includes(o.b) ? o.b : 'proof', aperture: APERTURES.includes(+o.a) ? +o.a : APERTURE, skipFlagged: o.f !== '0', comps: null, source: null, period: o.p === '1' };
  if (o.c != null) out.comps = o.c === '-' || o.c === '' ? [] : o.c.split('.').filter(x => /^\d+$/.test(x)).map(x => `Gaia DR3 ${x}`);
  if (o.s) { const [ra, dec] = o.s.split(',').map(Number); if (Number.isFinite(ra) && Number.isFinite(dec) && Math.abs(dec) <= 90) out.source = { ra, dec }; }
  return out;
}

// Snap a clicked sky position to the nearest catalogued star within `radius` arcsec (else the bare position).
export function snapSource(ra, dec, stars, mjd, radius = 9) {
  let best = null, bd = radius;
  for (const s of stars || []) {
    if (!Number.isFinite(s.ra)) continue;
    const p = Number.isFinite(mjd) && (s.pmra || s.pmdec) ? propagate({ ...s, epoch: s.epoch ?? 2016.0 }, mjd) : s;
    const d = separationArcsec(ra, dec, p.ra, p.dec);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { id: best.id, ra: best.ra, dec: best.dec, pmra: best.pmra || 0, pmdec: best.pmdec || 0, epoch: best.epoch ?? 2016.0, g: best.g, name: `${best.id} (G ${best.g?.toFixed(1)})` }
    : { ra, dec, pmra: 0, pmdec: 0, name: `the spot at ${ra.toFixed(4)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(4)}°` };
}
