// Is asteroid 1354 Botha really in the Asteroids page's example SPHEREx images?
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// The Asteroids page (web/neo.html) opens on a field where JPL PREDICTS 1354 Botha on 14 Dec 2025.
// This tool measures the SPHEREx images themselves with the app's own code: the field's image list
// (the page's own, sb-ident.js exposureForDate), every image of that visit (IRSA cutouts, irsa.js),
// and Botha's place at EACH image's mid-time (MJD-AVG) from JPL Horizons, seen from SPHEREx itself
// (observer -163182; from Earth's centre it would be ~1 px off). At that place: a 1.5 px aperture
// with a local sky ring (4-8 px, clipped median; noise = the ring's robust scatter), and the
// brightest pixel within 3 px (its 3x3 centroid's offset from the prediction).
// Rule for "a dot is there": S/N >= 5 and the peak within 1 px of the prediction. Pixels go through the
// app's own bad-pixel mask first (irsa.js maskBadPixels, the viewer's rule), the same for every image.
// Controls: (1) the same sky in every other D3/D6 image of the field (other dates, Botha elsewhere:
// Horizons says how far); (2) chance: 400 random sky places measured in all the visit images
// (how often a place shows a dot in all but one of them: that is what a star would do).
// Writes web/data/botha-check.json, which the Asteroids page reads (never typed numbers).
// Usage: node tools/botha_check.mjs [relay base, default http://127.0.0.1:8787]
import { writeFile } from 'node:fs/promises';
import { listImagesSIA, fetchCutoutLayers, exposureOf, mapLimit, maskBadPixels } from '../web/core/irsa.js';
import { configurePrebaked } from '../web/core/prebaked.js';
import { NEO_DEFAULT_VIEW, exposureForDate, mjdToIso } from '../web/app/neo/sb-ident.js';

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const OUT = new URL('../web/data/botha-check.json', import.meta.url);
const DATE = '2025-12-14';
const BOTHA = '1354;'; // Horizons: asteroid number 1354
const SPHEREX = '500@-163182'; // Horizons: SPHEREx spacecraft as the observer
const AP_R = 1.5, SKY_IN = 4, SKY_OUT = 8, SEARCH_R = 3, SNR_MIN = 5, OFFSET_MAX = 1;
const CUT_DEG = 0.1, CHANCE_N = 400;

// The page's own image list of the field centre (web/prebaked/ when saved there, else IRSA via the relay).
configurePrebaked({ manifestUrl: `${BASE}/prebaked/manifest.json`, fileBase: `${BASE}/prebaked/`, origin: BASE });

const median = (a) => { const s = a.slice().sort((p, q) => p - q), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const round = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

// Sky: median and robust scatter (1.4826 MAD) of the ring, clipped at 3 sigma (stars, cosmic rays).
function skyStats(vals) {
  let a = vals, mid = NaN, sig = NaN;
  for (let it = 0; it < 5; it++) {
    mid = median(a); sig = 1.4826 * median(a.map(v => Math.abs(v - mid)));
    const b = vals.filter(v => Math.abs(v - mid) <= 3 * sig);
    if (b.length === a.length) break;
    a = b;
  }
  return { sky: mid, sigma: sig, n: a.length };
}

function names(bits, flagNames) {
  return Object.entries(flagNames).filter(([b]) => bits & Number(b)).map(([, d]) => d.name);
}

// One measurement at (ra, dec) on the cutout's own pixels (no resampling).
function measure(cut, ra, dec, xy = null) {
  const { nx, ny, data } = cut.image;
  const [x, y] = xy || cut.wcs.worldToPix(ra, dec);
  if (!(x >= SKY_OUT + 1 && y >= SKY_OUT + 1 && x <= nx - SKY_OUT - 2 && y <= ny - SKY_OUT - 2)) return null;
  const ring = [];
  for (let j = Math.floor(y - SKY_OUT); j <= Math.ceil(y + SKY_OUT); j++) for (let i = Math.floor(x - SKY_OUT); i <= Math.ceil(x + SKY_OUT); i++) {
    const r = Math.hypot(i - x, j - y), v = data[j * nx + i];
    if (r >= SKY_IN && r <= SKY_OUT && Number.isFinite(v)) ring.push(v);
  }
  const { sky, sigma, n: nSky } = skyStats(ring);
  // Aperture with exact-ish pixel fractions (10x10 sub-pixels).
  let flux = 0, area = 0, varSum = 0, bits = 0, bad = 0;
  for (let j = Math.floor(y - AP_R - 1); j <= Math.ceil(y + AP_R + 1); j++) for (let i = Math.floor(x - AP_R - 1); i <= Math.ceil(x + AP_R + 1); i++) {
    let w = 0;
    for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) if (Math.hypot(i - 0.45 + a * 0.1 - x, j - 0.45 + b * 0.1 - y) <= AP_R) w++;
    if (!w) continue;
    w /= 100;
    const v = data[j * nx + i];
    if (!Number.isFinite(v)) { bad++; continue; }
    flux += w * (v - sky); area += w;
    const vv = cut.variance?.data[j * nx + i];
    if (Number.isFinite(vv)) varSum += w * w * vv;
    if (cut.flags) bits |= cut.flags.data[j * nx + i];
  }
  const noise = sigma * Math.sqrt(area + (Math.PI / 2) * area * area / nSky);
  // Brightest pixel within SEARCH_R px, then a 3x3 centroid around it.
  let best = null;
  for (let j = Math.floor(y - SEARCH_R); j <= Math.ceil(y + SEARCH_R); j++) for (let i = Math.floor(x - SEARCH_R); i <= Math.ceil(x + SEARCH_R); i++) {
    const v = data[j * nx + i];
    if (Math.hypot(i - x, j - y) <= SEARCH_R && Number.isFinite(v) && (!best || v > best.v)) best = { i, j, v };
  }
  let off = null, peakSnr = null;
  if (best) {
    let sw = 0, sx = 0, sy = 0;
    for (let j = best.j - 1; j <= best.j + 1; j++) for (let i = best.i - 1; i <= best.i + 1; i++) {
      const v = data[j * nx + i] - sky;
      if (Number.isFinite(v) && v > 0) { sw += v; sx += v * i; sy += v * j; }
    }
    if (sw > 0) off = Math.hypot(sx / sw - x, sy / sw - y);
    peakSnr = (best.v - sky) / sigma;
  }
  const snr = flux / noise;
  return {
    x, y, flux, sky, sigma, snr, snrVar: varSum > 0 ? flux / Math.sqrt(varSum) : null,
    peakSnr, offsetPx: off, badPixels: bad, flagBits: bits,
    seen: snr >= SNR_MIN && off !== null && off <= OFFSET_MAX,
  };
}

// Horizons astrometric RA/Dec (ICRF) at a list of UT Julian dates (unique times, 20 per call).
async function horizons(jds, center) {
  const keys = [...new Set(jds.map(j => j.toFixed(6)))].sort();
  const got = new Map();
  for (let i = 0; i < keys.length; i += 20) {
    const part = keys.slice(i, i + 20).map(Number);
    (await horizonsPart(part, center)).forEach((r, k) => got.set(part[k].toFixed(6), r));
  }
  return jds.map(j => got.get(j.toFixed(6)));
}
async function horizonsPart(jds, center) {
  const p = new URLSearchParams({
    format: 'json', COMMAND: `'${BOTHA}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'OBSERVER',
    CENTER: `'${center}'`, TLIST: `'${jds.map(j => j.toFixed(6)).join(' ')}'`, TLIST_TYPE: 'JD', TIME_TYPE: 'UT',
    QUANTITIES: "'1,9,20'", ANG_FORMAT: 'DEG', CSV_FORMAT: 'YES',
  });
  const res = await fetch(`${BASE}/jpl/horizons?${p}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Horizons HTTP ${res.status}`);
  const text = (await res.json()).result || '';
  const a = text.indexOf('$$SOE'), b = text.indexOf('$$EOE');
  if (a < 0 || b < a) throw new Error('Horizons: no ephemeris\n' + text.slice(0, 600));
  const rows = text.slice(a + 5, b).trim().split('\n').map(l => l.split(',').map(s => s.trim()));
  if (rows.length !== jds.length) throw new Error(`Horizons gave ${rows.length} rows for ${jds.length} times`);
  return rows.map(c => ({ ra: Number(c[3]), dec: Number(c[4]), vmag: Number(c[5]), deltaAU: Number(c[7]) }));
}

const sepArcsec = (a, b) => {
  const r = Math.PI / 180, dra = ((a.ra - b.ra + 540) % 360 - 180) * Math.cos(((a.dec + b.dec) / 2) * r);
  return Math.hypot(dra, a.dec - b.dec) * 3600;
};

async function main() {
  const { ra: fra, dec: fdec } = NEO_DEFAULT_VIEW;
  const images = await listImagesSIA(fra, fdec, { base: BASE });
  const time = exposureForDate(images, DATE);
  if (!time.covered) throw new Error(`no SPHEREx image of the field on ${DATE}`);
  const inVisit = (im) => im.mjdStart >= time.visit.mjdStart - 1e-6 && im.mjdStart <= time.visit.mjdEnd;
  const visit = images.filter(inVisit);
  const dets = [...new Set(visit.map(im => im.detector))].sort();
  const controls = images.filter(im => !inVisit(im) && dets.includes(im.detector));
  console.log(`visit ${time.exposure} ... : ${visit.length} images (D${dets.join(', D')}); ${controls.length} control images`);

  // Botha at the visit's middle (geocentric is enough to centre the cutouts).
  const [mid] = await horizons([time.mjd + 2400000.5], '500@399');
  const all = [...visit, ...controls];
  const cuts = await mapLimit(all, 4, (im) => fetchCutoutLayers(im.uri, mid.ra, mid.dec, CUT_DEG, { base: BASE, retries: 8, signal: AbortSignal.timeout(180000) }),
    (r, i) => process.stdout.write(r.ok ? '.' : `x(${all[i].obsid} D${all[i].detector}: ${r.error.message})`));
  console.log();
  const ok = all.map((im, i) => ({ im, raw: cuts[i].ok ? cuts[i].value : null })).filter(e => e.raw)
    .map(e => ({ ...e, cut: maskBadPixels(e.raw) }));
  const timesys = ok[0]?.cut.header.TIMESYS || 'UTC';
  // MJD-AVG is the image's mid-time; Horizons wants UT (TT/TDB headers are shifted by their offset).
  const toUtJd = (mjd) => mjd + 2400000.5 - (/^(TT|TDB)$/i.test(timesys) ? 69.184 / 86400 : 0);
  const jds = ok.map(e => toUtJd(e.cut.mjd));
  const [fromSpherex, fromEarth] = [await horizons(jds, SPHEREX), await horizons(jds, '500@399')];

  const vis = ok.map((e, k) => ({ ...e, k })).filter(e => inVisit(e.im));
  const ctl = ok.map((e, k) => ({ ...e, k })).filter(e => !inVisit(e.im));
  // The control spot: Botha's mean predicted place over the visit (the four places span < 1 px).
  const spot = { ra: vis.reduce((s, e) => s + fromSpherex[e.k].ra, 0) / vis.length, dec: vis.reduce((s, e) => s + fromSpherex[e.k].dec, 0) / vis.length };
  const fl = (cut, bits) => names(bits, cut.flagNames);
  const row = (e, at, extra = {}) => {
    const m = measure(e.cut, at.ra, at.dec), u = measure(e.raw, at.ra, at.dec);
    return {
      image: `${exposureOf(e.im.uri) || e.im.obsid} D${e.im.detector}`,
      detector: e.im.detector, band: [round(e.im.bandMinUm), round(e.im.bandMaxUm)],
      utc: mjdToIso(e.cut.mjd).slice(0, 19), mjd: round(e.cut.mjd, 6),
      ...extra,
      ...(m ? {
        x: round(m.x), y: round(m.y), snr: round(m.snr, 1), snrVariance: round(m.snrVar, 1), peakSnr: round(m.peakSnr, 1),
        peakOffsetPx: round(m.offsetPx), peakOffsetArcsec: round(m.offsetPx * 6.15, 1), flags: fl(e.cut, m.flagBits), maskedPixels: m.badPixels, seen: m.seen, snrUnmasked: round(u?.snr, 1), seenUnmasked: !!u?.seen,
      } : { outside: true, seen: false }),
    };
  };
  const exposures = vis.map(e => row(e, fromSpherex[e.k], {
    predicted: { ra: round(fromSpherex[e.k].ra, 6), dec: round(fromSpherex[e.k].dec, 6) },
    vmag: fromSpherex[e.k].vmag, earthCentreOffsetArcsec: round(sepArcsec(fromSpherex[e.k], fromEarth[e.k]), 1),
  })).sort((a, b) => a.detector - b.detector || a.mjd - b.mjd);
  const control = ctl.map(e => row(e, spot, { bothaAwayArcmin: round(sepArcsec(fromSpherex[e.k], spot) / 60, 1) }))
    .sort((a, b) => a.mjd - b.mjd || a.detector - b.detector);

  // Chance: random sky places (at least 5 px from Botha), each measured in every visit image.
  let rnd = 1;
  const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647; // fixed seed: repeatable
  const ref = vis[0].cut, [bx, by] = ref.wcs.worldToPix(spot.ra, spot.dec);
  let places = 0, steady = 0, tries = 0, hits = 0;
  for (let guard = 0; places < CHANCE_N && guard < 20 * CHANCE_N; guard++) {
    const x = SKY_OUT + 1 + rand() * (ref.image.nx - 2 * SKY_OUT - 3), y = SKY_OUT + 1 + rand() * (ref.image.ny - 2 * SKY_OUT - 3);
    if (Math.hypot(x - bx, y - by) < 5) continue;
    const [ra, dec] = ref.wcs.pixToWorld(x, y);
    const ms = vis.map(e => measure(e.cut, ra, dec));
    if (ms.some(m => !m)) continue;
    places++; tries += ms.length;
    const n = ms.filter(m => m.seen).length; hits += n;
    if (n >= ms.length - 1) steady++;
  }

  const measured = exposures.filter(r => !r.outside), seen = measured.filter(r => r.seen);
  const ctlMeasured = control.filter(r => !r.outside), ctlSeen = ctlMeasured.filter(r => r.seen);
  const snrs = seen.map(r => r.snr);
  const verdict = measured.length >= 7 && seen.length >= measured.length - 1 && ctlMeasured.length > 0 && ctlSeen.length === 0 ? 'seen' : 'not-clear';
  const ctlDates = [...new Set(ctlMeasured.map(r => r.utc.slice(0, 7)))];
  const out = {
    about: 'Is the JPL-predicted asteroid 1354 Botha visible in the Asteroids page example SPHEREx images? Measured by tools/botha_check.mjs (AI-written, Claude, Anthropic, for team Proper Motion).',
    generated: new Date().toISOString(),
    object: '1354 Botha', date: DATE, field: { ra: fra, dec: fdec },
    visit: { exposures: [...new Set(vis.map(e => exposureOf(e.im.uri)))].sort(), detectors: dets, utc: [mjdToIso(time.visit.mjdStart).slice(11, 16), mjdToIso(time.visit.mjdEnd).slice(11, 16)] },
    method: {
      ephemeris: `JPL Horizons, astrometric RA/Dec of ${BOTHA.replace(';', '')} seen from SPHEREx (${SPHEREX}) at each image's MJD-AVG (${timesys})`,
      apertureRadiusPx: AP_R, skyRingPx: [SKY_IN, SKY_OUT], peakSearchRadiusPx: SEARCH_R, pixelArcsec: 6.15,
      noise: 'robust scatter of the sky ring (snr); the pipeline VARIANCE layer as a cross-check (snrVariance)',
      rule: `a dot is there when S/N >= ${SNR_MIN} and the brightest pixel's centroid is within ${OFFSET_MAX} px of the prediction`,
      verdictRule: 'seen: at least 7 visit images measured, all but at most one pass the rule, and no control image passes it',
    },
    exposures,
    summary: { seen: seen.length, measured: measured.length, snrMin: snrs.length ? Math.min(...snrs) : null, snrMax: snrs.length ? Math.max(...snrs) : null },
    control: { spot: { ra: round(spot.ra, 6), dec: round(spot.dec, 6) }, measured: ctlMeasured.length, seen: ctlSeen.length, months: ctlDates, images: control },
    chance: { places, images: vis.length, perImageRate: round(hits / tries, 4), steadyPlaces: steady, steadyRate: round(steady / places, 4),
      note: 'random sky places in the same visit images: perImageRate = share of single measurements that pass the rule; steadyRate = share of places that pass in all but at most one image (a star would)' },
    verdict,
  };
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
  for (const r of exposures) console.log(r.image, r.utc, `S/N ${r.snr} (var ${r.snrVariance}) peak ${r.peakSnr} off ${r.peakOffsetPx} px`, r.seen ? 'SEEN' : '-', r.flags?.join('|') || '', `geo-off ${r.earthCentreOffsetArcsec}"`);
  console.log('control:', ctlSeen.length, 'of', ctlMeasured.length, 'pass; unmasked pass:', control.filter(r => r.seenUnmasked).map(r => r.image).join(', ') || 'none');
  console.log('chance:', hits, '/', tries, 'single;', steady, '/', places, 'steady; verdict:', verdict, '->', OUT.pathname);
}

main().catch((e) => { console.error(e); process.exit(1); });
