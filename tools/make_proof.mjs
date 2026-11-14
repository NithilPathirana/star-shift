// "How we know" numbers (DESIGN.md 32): run the app's own pipeline on the five quick-pick
// targets and write web/data/proof.json, which web/proof.html renders.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Same code as the viewer: data.js run() through the local relay (cutouts come from its disk
// cache), the viewer's default flip-book settings (2.5′ field, 120 images, all bands), the
// viewer's default flag filter (nothing hidden), and data.js measureMotion() for the motion.
// Catalogue values come live from SIMBAD (resolve.js endpoint), with the built-in presets
// (also SIMBAD) as the fallback if SIMBAD does not answer.
//
// Usage: (server running on 8787) node tools/make_proof.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { run, measureMotion, seasons, SYS_FLOOR_MASYR, MIN_MOTION_MASYR } from '../web/app/data.js';
import { PRESETS } from '../web/app/presets.js';
import { DEFAULT_SETTINGS } from '../web/app/query.js';
import { classifyFrame, visibleFrames, HIDE_IDS } from '../web/core/contam.js';
import { centroid } from '../web/core/align.js';
import { resolveName, gaiaCone, SIMBAD_TAP } from '../web/core/resolve.js';
import { parseCSV } from '../web/core/irsa.js';
import { propagate, separationArcsec, mjdToDate, mjdToEpochYear } from '../web/core/motion.js';
import { totalPM, totalPMErr, motionPA } from '../web/app/kinematics.js';
import { RULES, PIXEL_ARCSEC, motionVerdict, brightnessVerdict, meanSem } from '../web/app/proof/logic.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const SETTINGS = { ...DEFAULT_SETTINGS, fov: 2.5, max: 120, band: 'all' }; // the viewer's flip-book defaults (ui.js)
const TABLES = JSON.parse(readFileSync(new URL('../web/core/data/spectral_wcs.json', import.meta.url), 'utf8'));
const OUT = new URL('../web/data/proof.json', import.meta.url);
const SIMBAD_ID = { barnard: "Barnard's star", 'eps-indi-b': 'eps Ind B', 'wise-0855': 'WISE J085510.83-071442.5', 'rw-aur': 'RW Aur', 'r-dra': 'R Dra' };
const KIND = { barnard: 'moves', 'eps-indi-b': 'moves', 'wise-0855': 'moves', 'rw-aur': 'changes brightness', 'r-dra': 'changes brightness' };
const PM_REF = {
  '2020yCat.1350....0G': 'Gaia DR3 (via SIMBAD)',
  '2021ApJS..253....7K': 'Kirkpatrick et al. 2021, Spitzer + WISE (via SIMBAD)',
  '2007A&A...474..653V': 'Hipparcos, van Leeuwen 2007 reduction (via SIMBAD)',
};
const OTYPE = { 'BY*': 'BY Draconis variable (red dwarf)', 'BD*': 'brown dwarf', 'TT*': 'T Tauri star (young, varies irregularly)', 'Mi*': 'Mira variable (pulsating red giant)' };
const VARIABLE = new Set(['TT*', 'Mi*', 'Or*', 'LP*', 'V*']);
const APERTURE = 2.5; // px, brightness aperture
const BRIGHT_GROUPS = [{ name: '0.75–3.8 µm (detectors 1–4)', dets: [1, 2, 3, 4] }, { name: '3.8–5.0 µm (detectors 5–6)', dets: [5, 6] }];
const WL_MATCH = 0.05; // µm: brightness is compared only between images at the same wavelength (same detector)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const r2 = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : null);
const day = (mjd) => mjdToDate(mjd).toISOString().slice(0, 10);

async function tap(adql) {
  const res = await fetch(`${SIMBAD_TAP}?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=${encodeURIComponent(adql)}`);
  if (!res.ok) throw new Error('SIMBAD HTTP ' + res.status);
  return parseCSV(await res.text());
}

// Catalogue facts: proper motion with its error and source, object type, known variability.
async function catalogue(p) {
  const id = SIMBAD_ID[p.key];
  const out = { pmra: p.target.pmra, pmdec: p.target.pmdec, pmErr: null, bibcode: null, otype: null, periodDays: null, periodRef: null, live: false };
  try {
    const s = await resolveName(id);
    if (s) Object.assign(out, { pmra: s.pmra, pmdec: s.pmdec, otype: s.otype, live: true });
    const q = id.replace(/'/g, "''");
    const [b] = await tap(`SELECT b.pm_err_maj, b.pm_err_min, b.pm_bibcode FROM basic AS b JOIN ident AS i ON i.oidref = b.oid WHERE i.id = '${q}'`);
    if (b) { out.pmErrMaj = +b.pm_err_maj; out.pmErrMin = +b.pm_err_min; out.bibcode = b.pm_bibcode || null; }
    const vars = await tap(`SELECT v.vartyp, v.period, v.bibcode FROM mesVar AS v JOIN ident AS i ON i.oidref = v.oidref WHERE i.id = '${q}'`);
    const per = vars.find(v => v.period && /1358/.test(v.bibcode)) || vars.find(v => v.period);
    if (per) { out.periodDays = +per.period; out.periodRef = per.bibcode; out.vartyp = per.vartyp; }
  } catch (e) { console.log(`  SIMBAD: ${e.message}; using the built-in SIMBAD values`); }
  out.total = totalPM(out.pmra, out.pmdec);
  out.err = Number.isFinite(out.pmErrMaj) ? totalPMErr(out.pmra, out.pmdec, out.pmErrMaj, out.pmErrMin) : null;
  out.pa = motionPA(out.pmra, out.pmdec);
  return out;
}

// Run the viewer pipeline. If IRSA drops images, wait and ask again (the relay caches the rest).
async function loadTarget(p) {
  let frames = [], plan = null, failed = 0;
  for (let pass = 1; pass <= 3; pass++) {
    frames = []; failed = 0;
    await run({ type: 'name', name: p.label }, SETTINGS, { base: BASE, tables: TABLES, concurrency: 4, emit: (e) => {
      if (e.type === 'PLANNED') plan = e.plan;
      else if (e.type === 'FRAME') frames.push(e.frame);
      else if (e.type === 'FRAME_FAILED') failed++;
      else if (e.type === 'ERROR' || e.type === 'NOT_FOUND') console.log(`  ${p.label}: ${e.message}`);
    } });
    if (!failed) break;
    console.log(`  ${p.label}: ${failed} images failed (IRSA busy), waiting 30 s before asking again`);
    await sleep(30000);
  }
  frames.sort((a, b) => a.mjd - b.mjd);
  return { frames, plan, failed };
}

const seasonList = (fs) => seasons(fs).map(s => ({ from: day(s.startMjd), to: day(s.endMjd), n: s.frames.length }));

// measureMotion + what the page needs to draw it (east/north offsets in arcsec, parallax taken
// out, and measureMotion's own weighted fitted lines).
function motion(frames, grid) {
  const m = measureMotion(frames, grid);
  const used = m.ok ? seasons(m.points) : [];
  if (m.ok && used.length < 2) return { ok: false, reason: 'one season only', frames: m.frames }; // same rule as the viewer
  if (!m.ok) return { ok: false, reason: m.reason || 'no steady track', frames: m.frames || 0 };
  const dets = [...new Set(frames.filter(f => m.points.some(q => q.mjd === f.mjd)).map(f => f.detector))].sort();
  return { ok: true, total: m.total, totalErr: m.totalErr, statErr: m.statErr, sysErr: m.sysErr, refStars: m.refStars, significant: m.significant, upperLimit: m.upperLimit, pmra: m.pmra, pmdec: m.pmdec, pa: motionPA(m.pmra, m.pmdec),
    frames: m.frames, rejected: m.rejected, span: m.span, seasons: used.map(s => ({ from: day(s.startMjd), to: day(s.endMjd), n: s.frames.length })),
    detectors: dets,
    points: m.points.map(p => ({ mjd: r2(p.mjd, 3), e: r2(p.e, 3), n: r2(p.n, 3) })),
    fit: m.fit };
}
const brief = (m) => (m.ok ? { ok: true, total: r2(m.total, 0), totalErr: r2(m.totalErr, 0), statErr: r2(m.statErr, 0), sysErr: r2(m.sysErr, 0), significant: m.significant, upperLimit: r2(m.upperLimit, 0), frames: m.frames, pa: r2(m.pa, 1), span: r2(m.span, 2) } : { ok: false, reason: m.reason, frames: m.frames });

// Aperture brightness at the catalogue position, and how many of its pixels are masked
// (maskBadPixels sets saturated/overflow pixels to NaN, so a masked centre means no measurement).
function photometry(frames, grid) {
  return frames.map(f => {
    const [x0, y0] = f.expected || [grid.c, grid.c];
    let masked = 0, inside = 0;
    for (let j = Math.floor(y0 - APERTURE); j <= Math.ceil(y0 + APERTURE); j++) for (let i = Math.floor(x0 - APERTURE); i <= Math.ceil(x0 + APERTURE); i++) {
      if (i < 0 || j < 0 || i >= f.n || j >= f.n || Math.hypot(i - x0, j - y0) > APERTURE) continue;
      inside++; if (!Number.isFinite(f.data[j * f.n + i])) masked++;
    }
    const c = centroid(f, x0, y0, APERTURE, 1);
    return { mjd: f.mjd, det: f.detector, wl: f.wavelengthUm, flux: c?.flux ?? null, masked, inside };
  });
}

// Brightness change between seasons, comparing each image only with first-season images of the
// same detector at the same wavelength (±0.05 µm). Magnitudes: Δm = −2.5 log10(F / F_ref).
function brightnessChange(rows, allSeasons) {
  const seasonOf = (mjd) => allSeasons.findIndex(s => mjd >= s.startMjd - 0.01 && mjd <= s.endMjd + 0.01);
  const usable = rows.filter(r => r.masked === 0 && r.flux > 0 && Number.isFinite(r.wl)).map(r => ({ ...r, s: seasonOf(r.mjd) }));
  const firstS = Math.min(...usable.map(r => r.s));
  const first = usable.filter(r => r.s === firstS);
  const pts = [];
  for (const r of usable) {
    const ref = first.filter(q => q !== r && q.det === r.det && Math.abs(q.wl - r.wl) <= WL_MATCH);
    if (!ref.length) continue;
    const refFlux = ref.reduce((a, q) => a + q.flux, 0) / ref.length;
    pts.push({ mjd: r2(r.mjd, 3), s: r.s, det: r.det, wl: r2(r.wl, 3), dm: -2.5 * Math.log10(r.flux / refFlux) });
  }
  const bySeason = [...new Set(pts.map(p => p.s))].sort((a, b) => a - b).map(s => {
    const ms = meanSem(pts.filter(p => p.s === s).map(p => p.dm));
    return { season: s, from: day(allSeasons[s].startMjd), to: day(allSeasons[s].endMjd), mjd: r2(pts.filter(p => p.s === s).reduce((a, p) => a + p.mjd, 0) / ms.n, 1), n: ms.n, dm: r2(ms.mean, 3), sem: r2(ms.sem, 3) };
  });
  const a = bySeason[0], b = bySeason[bySeason.length - 1];
  const ok = bySeason.length >= 2 && a.season === firstS && a.n >= 3 && b.n >= 3 && a.sem != null && b.sem != null;
  const masked = rows.filter(r => r.masked > 0).length;
  return {
    ok, dmag: ok ? r2(b.dm - a.dm, 3) : null, dmagErr: ok ? r2(Math.hypot(a.sem, b.sem), 3) : null,
    frames: pts.length, maskedFrames: masked, totalFrames: rows.length,
    detectors: [...new Set(pts.map(p => p.det))].sort(), bySeason,
    points: pts.map(p => ({ mjd: p.mjd, det: p.det, wl: p.wl, dm: r2(p.dm, 3) })),
  };
}

const fmtPm = (masYr, d = 2) => (masYr / 1000).toFixed(d);
const list = (a) => a.join(', ');

console.log(`make_proof: ${PRESETS.length} targets, fov ${SETTINGS.fov}′, max ${SETTINGS.max}, via ${BASE}`);
const targets = [];
let barnardBrightness = null;
for (const p of PRESETS) {
  const t0 = Date.now();
  const cat = await catalogue(p);
  const { frames, plan, failed } = await loadTarget(p);
  if (!plan || !frames.length) throw new Error(`${p.label}: no images loaded; is the server running at ${BASE}?`);
  const grid = plan.grid;
  const cls = frames.map(f => classifyFrame({ flags: f.flags, flagNames: f.flagNames, n: grid.n, cx: (f.expected || [grid.c])[0], cy: (f.expected || [0, grid.c])[1], glow: f.glow }));
  const saturated = cls.filter(c => c.saturated).length;
  const flagged = frames.length - visibleFrames(frames, new Set(HIDE_IDS), f => cls[frames.indexOf(f)]).length;
  const allSeasons = seasons(frames);
  const longOnly = !!p.bandHint; // presets.js: "Only visible at 3.8–5 µm (bands 5–6)"
  const main = longOnly ? frames.filter(f => f.detector >= 5) : frames;
  const M = {
    all: motion(frames, grid),
    short: motion(frames.filter(f => f.detector <= 4), grid),
    long: motion(frames.filter(f => f.detector >= 5), grid),
    filtersOn: motion(visibleFrames(main, new Set(HIDE_IDS), f => cls[frames.indexOf(f)]), grid),
  };
  const m = longOnly ? M.long : M.all;
  const spanYears = (frames[frames.length - 1].mjd - frames[0].mjd) / 365.25;
  const v = motionVerdict(m, cat.total, cat.err, m.ok ? m.span : spanYears);
  const catRef = PM_REF[cat.bibcode] || (cat.bibcode ? `${cat.bibcode} (via SIMBAD)` : 'SIMBAD');

  // ---- honest limits, written from the numbers ----
  const extra = {};
  let limit;
  if (v.verdict === 'NOT MEASURABLE' && v.why === 'slow') {
    limit = `The catalogue motion (${fmtPm(cat.total)}″/yr) moves it only ${(v.shiftPx * PIXEL_ARCSEC).toFixed(3)}″ (${v.shiftPx.toFixed(3)} of a 6.15″ pixel) over the ${spanYears.toFixed(1)} years of images, far below what one pixel can show.`;
    if (m.ok) limit += m.significant
      ? ` The fit still finds ${fmtPm(m.total)} ± ${fmtPm(m.totalErr)}″/yr, which is not a real motion: ${saturated > frames.length / 2
        ? `the centre is flagged saturated in ${saturated} of ${frames.length} images, so its position comes from the edges of a blanked core.`
        : `stars this still should show none, so this is the star's own light centre shifting, or an effect of its bright centre that the ${fmtPm(m.sysErr)}″/yr floor does not cover.`}`
      : ` As expected, the images show no significant motion (< ${fmtPm(m.upperLimit)}″/yr). The fit gives ${fmtPm(m.total)} ± ${fmtPm(m.totalErr)}″/yr; a motion under 3 times its uncertainty, or under ${fmtPm(MIN_MOTION_MASYR, 1)}″/yr, is not claimed.`;
  } else if (p.key === 'wise-0855') {
    try {
      const at = propagate(p.target, (frames[0].mjd + frames[frames.length - 1].mjd) / 2);
      const g = await gaiaCone(at.ra, at.dec, 15);
      extra.neighbours = g.map(s => ({ id: s.id, g: r2(s.g, 2), sepArcsec: r2(separationArcsec(at.ra, at.dec, s.ra, s.dec), 1) })).sort((a, b) => a.sepArcsec - b.sepArcsec);
    } catch (e) { console.log('  Gaia: ' + e.message); }
    const nb = extra.neighbours?.[0];
    limit = `Faint at short wavelengths: only the two longest bands (detectors 5–6, 3.8–5.0 µm) were used. With detectors 1–4 the fit gives ${M.short.ok ? `${fmtPm(M.short.total)} ± ${fmtPm(M.short.totalErr)}″/yr` : 'no track'}${nb ? `, because it locks on a background star (Gaia G ${nb.g}) ${nb.sepArcsec}″ away that does not move` : ', locking on light that does not move'}.`;
  } else if (p.key === 'eps-indi-b') {
    try {
      const a = await resolveName('eps Ind');
      const at = (frames[0].mjd + frames[frames.length - 1].mjd) / 2;
      const pa = propagate(a, at), pb = propagate(p.target, at);
      extra.brightNeighbour = { name: 'Epsilon Indi A', sepArcsec: r2(separationArcsec(pa.ra, pa.dec, pb.ra, pb.dec), 0), cutoutHalfArcsec: r2(grid.n * grid.scale / 2, 0) };
    } catch (e) { console.log('  SIMBAD eps Ind: ' + e.message); }
    const scatterHits = cls.filter(c => c.hits?.scatter != null).length;
    const nb = extra.brightNeighbour;
    limit = `${nb ? `Epsilon Indi A is ${(nb.sepArcsec / 60).toFixed(1)}′ away, outside this ${(2 * nb.cutoutHalfArcsec / 60).toFixed(1)}′ patch, and ` : ''}${scatterHits ? `${scatterHits} images carry scattered-light flags near B` : 'no image has scattered-light flags near B'}; hiding every flagged image gives ${M.filtersOn.ok ? `${fmtPm(M.filtersOn.total)} ± ${fmtPm(M.filtersOn.totalErr)}″/yr` : 'no fit'}. ${m.ok ? `The value is ${Math.abs((1 - m.total / cat.total) * 100).toFixed(0)}% ${m.total < cat.total ? 'below' : 'above'} the catalogue (${v.sigma != null ? v.sigma.toFixed(1) : '–'}σ with the ${fmtPm(m.sysErr)}″/yr floor measured on field stars). Epsilon Indi B is itself a pair of brown dwarfs 0.7″ apart; their orbit moves the light centre by up to about 0.1″/yr, by different amounts at Gaia's visible wavelengths and SPHEREx's infrared ones, so a small difference is expected.` : ''}`;
    extra.scatterHits = scatterHits;
  } else {
    limit = `The star's centre is flagged saturated in ${saturated} of ${frames.length} images, so its centre is found from the unsaturated edge pixels; images with a blanked centre count for less in the fit because their positions scatter more. The long-wavelength detectors alone give ${M.long.ok ? `${fmtPm(M.long.total)} ± ${fmtPm(M.long.totalErr)}″/yr` : 'no fit'}, the short ones ${M.short.ok ? `${fmtPm(M.short.total)} ± ${fmtPm(M.short.totalErr)}″/yr` : 'no fit'}.`;
  }

  const tests = [{
    type: 'motion',
    test: 'moves',
    expected: { value: r2(cat.total, 1), err: r2(cat.err, 2), unit: 'mas/yr', pa: r2(cat.pa, 1), source: catRef, epoch: 'J2000 position; motion per year' },
    measured: m.ok ? { value: r2(m.total, 0), err: r2(m.totalErr, 0), statErr: r2(m.statErr, 0), sysErr: r2(m.sysErr, 0), refStars: m.refStars, significant: m.significant, upperLimit: r2(m.upperLimit, 0), unit: 'mas/yr', pa: r2(m.pa, 1), frames: m.frames, rejected: m.rejected,
      span: r2(m.span, 2), seasons: m.seasons, detectors: m.detectors, bands: longOnly ? 'detectors 5–6 only' : 'all detectors' } : null,
    diff: m.ok && v.verdict !== 'NOT MEASURABLE' ? { value: r2(m.total - cat.total, 0), sigma: r2(v.sigma, 1), unit: 'mas/yr' } : null,
    verdict: v.verdict, shiftPx: r2(v.shiftPx, 3), limit,
    chart: m.ok ? { kind: 'motion', pa: r2(cat.pa, 2), catalogueMasYr: r2(cat.total, 1), points: m.points, fit: m.fit } : null,
    // Not-measurable rows still show what the fit gives, so the method's floor is visible.
    fitAnyway: v.verdict === 'NOT MEASURABLE' && m.ok ? { value: r2(m.total, 0), err: r2(m.totalErr, 0), statErr: r2(m.statErr, 0), sysErr: r2(m.sysErr, 0), significant: m.significant, upperLimit: r2(m.upperLimit, 0), frames: m.frames } : null,
    variants: { all: brief(M.all), short: brief(M.short), long: brief(M.long), filtersOn: brief(M.filtersOn) },
  }];

  // ---- brightness (variables, plus Barnard's Star as the steady control) ----
  // Two wavelength groups, measured separately: a young star can get brighter at short
  // wavelengths while it fades at long ones, and an average over both would hide that.
  const isVar = VARIABLE.has(cat.otype) && KIND[p.key] === 'changes brightness';
  if (isVar || p.key === 'barnard') {
    const rows = photometry(frames, grid);
    const groups = BRIGHT_GROUPS.map(g => ({ ...g, ...brightnessChange(rows.filter(r => g.dets.includes(r.det)), allSeasons) }))
      .map(g => ({ ...g, sigma: g.ok ? r2(Math.abs(g.dmag) / g.dmagErr, 1) : null }));
    const usable = groups.reduce((a, g) => a + g.frames, 0), masked = rows.filter(r => r.masked > 0).length;
    if (p.key === 'barnard') barnardBrightness = { label: p.label, usable, masked, total: rows.length, groups: groups.map(({ points, ...g }) => g) };
    else {
      const ok = groups.filter(g => g.ok);
      const best = ok.length ? ok.reduce((a, g) => (g.sigma > a.sigma ? g : a)) : null;
      const bv = brightnessVerdict(best ? { ok: true, dmag: best.dmag, dmagErr: best.dmagErr } : null, true);
      const C = barnardBrightness, cg = C?.groups.flatMap(g => g.bySeason.slice(1).map(s => Math.abs(s.dm))) || [];
      const ctl = C && cg.length ? ` Control: on Barnard's Star, a steady star, the season averages stay within ${Math.max(...cg).toFixed(2)} mag of the first season (only ${C.usable} of its ${C.total} images have an unmasked centre).` : '';
      const period = cat.periodDays ? `Period ${cat.periodDays.toFixed(1)} days` : 'No fixed period';
      tests.push({
        type: 'brightness', test: 'changes brightness',
        expected: { text: `${OTYPE[cat.otype] || cat.otype}. ${period}.`, periodDays: r2(cat.periodDays, 1), otype: cat.otype,
          source: cat.periodDays ? (cat.periodRef === '2022yCat.1358....0G' ? 'SIMBAD type; period from Gaia DR3 variability' : `SIMBAD type; period ${cat.periodRef}`) : 'SIMBAD object type' },
        measured: ok.length ? { unit: 'mag', groups: groups.map(g => ({ name: g.name, ok: g.ok, value: g.dmag, err: g.dmagErr, sigma: g.sigma, frames: g.frames, seasons: g.bySeason })), frames: usable } : null,
        diff: best ? { sigma: best.sigma, group: best.name, text: 'change divided by its uncertainty' } : null,
        verdict: bv.verdict,
        limit: ok.length
          ? `Only images with no masked pixel within ${(APERTURE * PIXEL_ARCSEC).toFixed(0)}″ of the star count, each compared with first-season images from the same detector at the same wavelength: ${usable} of ${frames.length} images qualify (${masked} have a saturated, masked centre; the rest have no first-season match). The catalogue gives no amplitude at these wavelengths, so only the fact of a change is tested.${ctl}`
          : `Too bright for SPHEREx: in ${masked} of ${frames.length} images the centre pixels are saturated and masked, leaving ${usable} usable comparisons, too few to measure a change.`,
        chart: ok.length ? { kind: 'brightness', groups: groups.map(g => ({ name: g.name, points: g.points, seasons: g.bySeason })) } : null,
      });
    }
  }

  targets.push({
    key: p.key, label: p.label, name: p.target.name, kind: KIND[p.key], otype: cat.otype, otypeText: OTYPE[cat.otype] || cat.otype,
    simbadLive: cat.live, viewer: `index.html?q=${encodeURIComponent(p.label)}&scene=viewer`,
    images: { archive: plan.total, planned: plan.planned, loaded: frames.length, failed, saturatedCore: saturated, flaggedNearStar: flagged,
      first: day(frames[0].mjd), last: day(frames[frames.length - 1].mjd), seasons: seasonList(frames) },
    extra, tests,
  });
  const t = tests[0];
  console.log(`${p.label}: ${frames.length} images, ${((Date.now() - t0) / 1000).toFixed(1)} s | motion ${t.verdict} ${t.measured ? `${t.measured.value} ± ${t.measured.err} vs ${t.expected.value} mas/yr (${t.diff?.sigma ?? '–'}σ)` : ''}${tests[1] ? ` | brightness ${tests[1].verdict} ${JSON.stringify(tests[1].measured?.groups.map(g => [g.value, g.err, g.sigma, g.frames]))}` : ''}`);
}

const out = {
  about: 'Numbers for web/proof.html, computed by tools/make_proof.mjs from the app pipeline (data.js) on cached SPHEREx cutouts. AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.',
  generated: new Date().toISOString(),
  settings: { fovArcmin: SETTINGS.fov, maxImages: SETTINGS.max, band: SETTINGS.band, flagFilter: 'viewer default: no flag boxes ticked, no images hidden', sysFloorMasYr: SYS_FLOOR_MASYR, minMotionMasYr: MIN_MOTION_MASYR, apertureArcsec: r2(APERTURE * PIXEL_ARCSEC, 1), wavelengthMatchUm: WL_MATCH },
  pixelArcsec: PIXEL_ARCSEC, rules: RULES, control: barnardBrightness, targets,
};
mkdirSync(new URL('../web/data/', import.meta.url), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('wrote web/data/proof.json');
