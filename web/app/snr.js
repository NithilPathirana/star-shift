// Signal-to-noise (SNR) of one spot on one SPHEREx image: aperture photometry, no DOM.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Used by the viewer ("Signal-to-noise" in the side panel), Spot's verdict card, and the light-curve
// builder. Works on NATIVE image pixels ({ nx, ny, data } from fits.js readImage), not the viewer's
// reprojected grid: bilinear resampling smooths the noise, so its pixel scatter would understate it.
//
//   flux  F = Σ (I_i − B) over the aperture (pixel centres within r of the spot)
//   B     = median of the sky annulus (rIn < d ≤ rOut); σ_sky = 1.4826 × MAD of the annulus
//   noise σ² = Σ VAR_i (VARIANCE layer: sky + the star's own photon noise + read noise)
//            + N_ap² × (π/2) σ_sky² / N_sky   (the error of the median sky level)
//   Without VARIANCE: Σ VAR_i is replaced by N_ap σ_sky² (sky scatter only, so the star's own photon
//   noise is left out and a bright star's SNR comes out too high; the callers say so).
//   Stacks: SNR_n = SNR_1 × √n, if each of the n images is like this one (independent noise).

export const SNR_DEFAULT_R = 2;           // px (12.3″), adjustable 1–4
export const SNR_R_MIN = 1, SNR_R_MAX = 4;
export const PIXEL_ARCSEC = 6.15;
// Sky ring: 2 px clear of the aperture, 4 px wide (4–8 px for the default 2 px aperture, as Spot's colour check).
export const annulusFor = (r) => [r + 2, r + 6];
const MIN_SKY = 12; // fewer usable sky pixels than this: no honest background

function median(a) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort(), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Bit mask of the flag names given, from a FLAGS header's { bit: { name } } map (irsa.js flagDefinitions).
export function maskOf(flagNames, names) {
  let m = 0;
  for (const [bit, d] of Object.entries(flagNames || {})) if (names.includes(d.name)) m |= Number(bit);
  return m;
}
// Flags that make a pixel's value untrustworthy (excluded and counted), and the ones that mean
// "saturated" (OVERFLOW: the ramp overflowed) or "blanked" (no data) at the centre.
export const EXCLUDE_FLAGS = ['TRANSIENT', 'OVERFLOW', 'SUR_ERROR', 'NONFUNC', 'MISSING_DATA', 'HOT', 'COLD', 'PERSIST', 'OUTLIER'];
export const SATURATED_FLAGS = ['OVERFLOW'];
export const BLANK_FLAGS = ['NONFUNC', 'MISSING_DATA'];

/**
 * Aperture photometry at pixel (x, y) (0-based, the same convention as wcs.worldToPix).
 * img, variance, flags: { nx, ny, data } on the same native pixels (variance, flags may be null).
 * flagNames: the FLAGS header map, for the exclusion / saturation masks.
 * Returns { ok, reason, ... } — reason 'saturated' | 'blanked' | 'edge' | 'nosky' when not meaningful.
 */
export function aperturePhotometry(img, x, y, { r = SNR_DEFAULT_R, variance = null, flags = null, flagNames = null, annulus } = {}) {
  r = Math.min(SNR_R_MAX, Math.max(SNR_R_MIN, Number(r) || SNR_DEFAULT_R));
  const [rIn, rOut] = annulus || annulusFor(r);
  const { nx, ny, data } = img;
  const fl = flags?.data || null;
  const bad = fl ? maskOf(flagNames, EXCLUDE_FLAGS) : 0, sat = fl ? maskOf(flagNames, SATURATED_FLAGS) : 0, blank = fl ? maskOf(flagNames, BLANK_FLAGS) : 0;
  const base = { r, rIn, rOut, x, y, noiseFrom: variance ? 'variance+sky' : 'sky' };
  // centre: the nearest pixel blank / NaN -> blanked; an overflowed pixel within 1.5 px -> saturated
  const ci = Math.round(x), cj = Math.round(y);
  if (ci < 0 || cj < 0 || ci >= nx || cj >= ny) return { ...base, ok: false, reason: 'edge' };
  const c = cj * nx + ci;
  // SPHEREx blanks (NaN) the overflowed core of a bright star: that is saturation, not missing data
  if (fl) for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
    if (i >= 0 && j >= 0 && i < nx && j < ny && Math.hypot(i - x, j - y) <= 1.5 && (fl[j * nx + i] & sat)) return { ...base, ok: false, reason: 'saturated' };
  }
  if (!Number.isFinite(data[c]) || (fl && (fl[c] & blank))) return { ...base, ok: false, reason: 'blanked' };
  const ap = [], apVar = [], sky = [];
  let nAp = 0, nApFlagged = 0, nApMissing = 0, nSkyFlagged = 0;
  const R = Math.ceil(rOut);
  for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
    const d = Math.hypot(i - x, j - y);
    const inAp = d <= r, inSky = d > rIn && d <= rOut;
    if (!inAp && !inSky) continue;
    if (i < 0 || j < 0 || i >= nx || j >= ny) { if (inAp) return { ...base, ok: false, reason: 'edge' }; continue; } // a cut circle undercounts the light
    const k = j * nx + i, v = data[k], f = fl ? fl[k] : 0;
    if (inAp) {
      nAp++;
      if (!Number.isFinite(v)) { nApMissing++; continue; }
      if (f & bad) { nApFlagged++; continue; }
      const vv = variance ? variance.data[k] : NaN;
      if (variance && !(Number.isFinite(vv) && vv >= 0)) { nApMissing++; continue; }
      ap.push(v); apVar.push(vv);
    } else {
      if (!Number.isFinite(v)) continue;
      if (f & bad) { nSkyFlagged++; continue; }
      sky.push(v);
    }
  }
  const out = { ...base, nAp, nApUsed: ap.length, nApFlagged, nApMissing, nSky: sky.length, nSkyFlagged };
  if (nApMissing > nAp / 2 || !ap.length) return { ...out, ok: false, reason: nApMissing ? 'edge' : 'blanked' };
  if (sky.length < MIN_SKY) return { ...out, ok: false, reason: 'nosky' };
  const bg = median(sky);
  const sigmaSky = 1.4826 * median(sky.map(v => Math.abs(v - bg)));
  const n = ap.length;
  const flux = ap.reduce((a, v) => a + (v - bg), 0);
  const varSum = variance ? apVar.reduce((a, v) => a + v, 0) : n * sigmaSky * sigmaSky;
  const skyErr2 = n * n * (Math.PI / 2) * sigmaSky * sigmaSky / sky.length;
  const noise = Math.sqrt(varSum + skyErr2);
  const snr = noise > 0 ? flux / noise : NaN;
  return { ...out, ok: Number.isFinite(snr), reason: Number.isFinite(snr) ? null : 'nosky', bg, sigmaSky, flux, varSum, skyErr2, noise, snr, peak: Math.max(...ap) - bg };
}

// SNR if n images like this one are combined (independent noise): √n better.
export const stackedSNR = (snr, n) => (Number.isFinite(snr) && n > 0 ? snr * Math.sqrt(n) : NaN);

// How many images share this one's detector: in its season (season = index into bounds) and in all.
// frames: [{ mjd, detector }]; seasonOf(mjd) -> season index (seasons.js seasonAt with the page's bounds).
export function detectorCounts(frames, cur, seasonOf) {
  const same = frames.filter(f => f.detector === cur.detector);
  const k = seasonOf(cur.mjd);
  return { season: k, nSeason: same.filter(f => seasonOf(f.mjd) === k).length, nAll: same.length };
}

export function snrWord(snr) {
  if (!Number.isFinite(snr)) return '';
  return snr >= 5 ? 'clearly real' : snr >= 3 ? 'faint: probably real, but check other images' : 'not clearly above the noise';
}
const round = (v) => (Math.abs(v) >= 10 ? Math.round(v).toString() : v.toFixed(1));
export const REASON_TEXT = {
  saturated: 'SNR not meaningful here (centre saturated)',
  blanked: 'SNR not meaningful here (centre blanked: no good data)',
  edge: 'SNR not meaningful here (too close to the image edge)',
  nosky: 'SNR not meaningful here (not enough clean sky around it)',
};

/**
 * Words for one result. counts: { nSeason, nAll } same-detector images (optional).
 * Returns { simple, expert: [lines], line } — `line` is the one-line headline for both modes.
 */
export function snrText(p, counts = {}, { detector } = {}) {
  if (!p.ok) { const t = REASON_TEXT[p.reason] || 'SNR not meaningful here'; return { line: t, simple: t, expert: [t] }; }
  const s1 = p.snr, ns = counts.nSeason, na = counts.nAll, det = detector ? `detector ${detector}` : 'this detector';
  const line = `Signal-to-noise ${round(s1)}: ${snrWord(s1)}.`;
  const st = [];
  if (ns > 1) st.push(`Stacking this season's ${ns} images from ${det}: about ${round(stackedSNR(s1, ns))}.`);
  if (na > 1 && na !== ns) st.push(`All ${na} images from ${det} combined: about ${round(stackedSNR(s1, na))}.`);
  const simple = [line, ...st].join(' ');
  const f = (v) => (Math.abs(v) >= 100 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(3) : v.toPrecision(4));
  const expert = [
    `SNR = F / σ = ${f(p.flux)} / ${f(p.noise)} = ${s1.toFixed(2)}`,
    `F = Σ(I − B) over ${p.nApUsed} px within r = ${p.r} px (${(p.r * PIXEL_ARCSEC).toFixed(1)}″)${p.nApFlagged ? `; ${p.nApFlagged} flagged px left out (F is a lower limit)` : ''}`,
    `B = ${f(p.bg)} MJy/sr: median of ${p.nSky} sky px, ${p.rIn}–${p.rOut} px out${p.nSkyFlagged ? ` (${p.nSkyFlagged} flagged px left out)` : ''}; σ_sky = ${f(p.sigmaSky)} (1.4826 × MAD)`,
    p.noiseFrom === 'variance+sky'
      ? `σ² = ΣVAR + N²(π/2)σ_sky²/N_sky = ${f(p.varSum)} + ${f(p.skyErr2)} (VARIANCE layer + sky level error)`
      : `σ² = Nσ_sky² + N²(π/2)σ_sky²/N_sky = ${f(p.varSum)} + ${f(p.skyErr2)} (sky scatter only: VARIANCE not loaded, so the star's own photon noise is left out and a bright star's SNR is too high)`,
    ...(ns > 1 || na > 1 ? [`Stacks: SNR × √n (if each image is like this one): season n = ${ns || 1} → ${stackedSNR(s1, ns || 1).toFixed(1)}; all n = ${na || 1} → ${stackedSNR(s1, na || 1).toFixed(1)}`] : []),
  ];
  return { line, simple, expert };
}

export const CSV_HEAD = 'target,obsid,mjd,detector,wavelength_um,ra_deg,dec_deg,x_px,y_px,r_px,r_in_px,r_out_px,n_ap,n_flagged,n_sky,bg_MJy_sr,sigma_sky_MJy_sr,var_sum,sky_err2,flux_MJy_sr_px,noise,snr,noise_from,n_season_det,snr_season_det,n_all_det,snr_all_det,note';
const q = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const num = (v, d = 6) => (Number.isFinite(v) ? +v.toPrecision(d) : '');
export function csvRow(p, meta = {}, counts = {}) {
  const ns = counts.nSeason || '', na = counts.nAll || '';
  return [q(meta.target ?? ''), q(meta.obsid ?? ''), num(meta.mjd, 10), meta.detector ?? '', num(meta.wavelengthUm, 4), num(meta.ra, 9), num(meta.dec, 9),
    num(p.x, 5), num(p.y, 5), p.r, p.rIn, p.rOut, p.nApUsed ?? '', p.nApFlagged ?? '', p.nSky ?? '', num(p.bg), num(p.sigmaSky), num(p.varSum), num(p.skyErr2),
    num(p.flux), num(p.noise), num(p.snr, 4), p.noiseFrom, ns, p.ok && ns ? num(stackedSNR(p.snr, ns), 4) : '', na, p.ok && na ? num(stackedSNR(p.snr, na), 4) : '',
    q(p.ok ? '' : (REASON_TEXT[p.reason] || p.reason))].join(',');
}
