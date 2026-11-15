// Brightness-vs-date strip (web/app/lightcurve/logic.js) and Clean Blink helpers (web/app/cleanblink.js).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, lightcurve, message, skippedText, toMilliJy, pixelSr, seasonIndex, GROUPS, CAPTION, fmtMag,
  saturatedNote, lightOnSky, pickSource, pickSaved, notHereText } from '../web/app/lightcurve/logic.js';
import { cleanOpt, centrePan } from '../web/app/cleanblink.js';

const N = 25, C = 12, grid = { n: N, c: C, scale: 6.15 };
// A frame with a gaussian star of total `flux` (MJy/sr summed over pixels) on a flat background.
function frame({ mjd, det, wl, flux = 1000, bg = 5, mask = false, at = [C, C], star = at }) {
  const data = new Float32Array(N * N), s = 1.0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const r2 = (i - star[0]) ** 2 + (j - star[1]) ** 2;
    data[j * N + i] = bg + flux * Math.exp(-r2 / (2 * s * s)) / (2 * Math.PI * s * s);
  }
  if (mask) data[Math.round(at[1]) * N + Math.round(at[0])] = NaN;
  return { n: N, data, mjd, detector: det, wavelengthUm: wl, expected: at };
}
// Three seasons, six images per season per detector at matching wavelengths.
function seasons3(fluxBySeason, { dets = [2, 5], maskAll = false, starOf = () => undefined } = {}) {
  const out = [];
  [60900, 61080, 61270].forEach((t, s) => dets.forEach(det => {
    for (let k = 0; k < 6; k++) out.push(frame({ mjd: t + k * 2 + det * 0.1, det, wl: det === 2 ? 1.30 + (k % 2) * 0.01 : 4.20 + (k % 2) * 0.01, flux: fluxBySeason(s, det), mask: maskAll, star: starOf(det) }));
  }));
  return out.sort((a, b) => a.mjd - b.mjd);
}

test('MJy/sr summed over 6.15″ pixels converts to mJy with the pixel solid angle', () => {
  const sr = pixelSr(6.15);
  assert.ok(Math.abs(sr - 8.8898e-10) / 8.8898e-10 < 1e-3);
  assert.ok(Math.abs(toMilliJy(1, 6.15) - 0.88898) < 1e-3); // 1 MJy/sr·px × 8.89e-10 sr = 8.89e-4 MJy = 0.889 mJy
  assert.ok(Math.abs(toMilliJy(1, 3.075) - 0.88898 / 4) < 1e-3, 'smaller pixels, smaller solid angle');
});

test('aperture minus background recovers the star flux, in mJy', () => {
  const [r] = measure([frame({ mjd: 1, det: 1, wl: 1, flux: 1000, bg: 7 })], grid);
  assert.equal(r.masked, 0);
  assert.ok(r.flux > 950 && r.flux <= 1000, `flux ${r.flux}`); // 2.5 px aperture holds ~95%+ of a σ = 1 px star
  assert.ok(Math.abs(r.mJy - toMilliJy(r.flux, 6.15)) < 1e-9);
});

test('a steady star is flat; a star that fades only at long wavelengths shows it there and nowhere else', () => {
  const flat = lightcurve(measure(seasons3(() => 1000), grid));
  assert.equal(flat.status, 'ok');
  for (const g of flat.groups) { assert.ok(g.ok); assert.ok(Math.abs(g.dmag) < 1e-6); }
  // detector 5 fades by half in the last season (+0.753 mag); detector 2 stays steady
  const lc = lightcurve(measure(seasons3((s, det) => (det === 5 && s === 2 ? 500 : 1000)), grid));
  const [short, long] = lc.groups;
  assert.deepEqual([short.id, long.id], ['short', 'long']);
  assert.ok(Math.abs(short.dmag) < 1e-6, 'groups are never averaged together');
  assert.ok(Math.abs(long.dmag - 2.5 * Math.log10(2)) < 0.01, `long ${long.dmag}`);
  assert.equal(long.bySeason.length, 3);
  assert.equal(lc.plotted, 36);
});

test('images with masked centre pixels are skipped and counted', () => {
  const fs = seasons3(() => 1000);
  fs[3] = { ...fs[3], data: Float32Array.from(fs[3].data) }; fs[3].data[C * N + C] = NaN;
  const lc = lightcurve(measure(fs, grid));
  assert.equal(lc.masked, 1);
  assert.equal(lc.plotted, 35);
  assert.ok(!lc.groups.some(g => g.points.some(p => p.idx === 3)));
  assert.match(skippedText(lc), /^35 of 36 images plotted · 1 skipped: a masked pixel within 15″/);
});

test('only same-detector, same-wavelength first-season images are references', () => {
  const fs = seasons3(() => 1000);
  fs.push(frame({ mjd: 61275, det: 2, wl: 1.6, flux: 1000 })); // 1.6 µm: no first-season image within 0.05 µm
  const lc = lightcurve(measure(fs, grid));
  assert.equal(lc.groups[0].noMatch, 1);
  assert.match(skippedText(lc), /1 with no first-season image at the same wavelength/);
});

test('a star saturated in every image says so plainly (R Draconis)', () => {
  const lc = lightcurve(measure(seasons3(() => 1000, { maskAll: true }), grid));
  assert.equal(lc.status, 'saturated');
  assert.equal(lc.plotted, 0);
  assert.equal(message(lc, 'R Draconis'), 'R Draconis is saturated in every SPHEREx image here, so its brightness cannot be measured.');
  assert.match(skippedText(lc), /^0 of 36 images plotted · 36 skipped: a masked pixel within 15″/);
});

test('a9: the saturated dead end says why, with the counts from the data, and where to go', () => {
  const lc = lightcurve(measure(seasons3(() => 1000, { maskAll: true }), grid));
  const n = saturatedNote(lc, 'R Draconis');
  assert.equal(n.text, "Too bright for SPHEREx: the centre is saturated in all 36 images, so its brightness can't be measured here.");
  assert.deepEqual(n.links.map(l => l.href), ['index.html?q=RW%20Aurigae&scene=viewer', 'proof.html']);
  assert.deepEqual(saturatedNote(lc, 'RW Aurigae').links.map(l => l.text), ['How we know →'], 'never links a star to itself');
  assert.equal(saturatedNote(lightcurve(measure(seasons3(() => 1000), grid)), 'X'), null);
});

// a3: WISE 0855 at 0.75–3.8 µm. The brown dwarf is invisible there; the light in the aperture is a
// background star 1.27 px (7.8″) away. Same thresholds as the motion fit; no names involved.
const skyGrid = { ...grid, ra0: 133.79, dec0: -7.24 };
test('a3: light centred on another source is "not detected here", and only that group', () => {
  const lc = lightcurve(measure(seasons3(() => 1000, { starOf: det => (det === 2 ? [C + 1.1, C - 0.65] : undefined) }), skyGrid));
  const [short, long] = lc.groups;
  assert.equal(short.detect.state, 'offset'); assert.ok(short.absent);
  assert.equal(short.points.length, 0); assert.equal(short.dmag, null, 'no "mag brighter" from the wrong star');
  assert.equal(short.notHere, 18);
  assert.equal(long.detect.state, 'ok'); assert.ok(long.ok, 'the other group is untouched');
  assert.equal(lc.status, 'ok');
  assert.match(skippedText(lc), /18 where the light is not the target's/);
  const sky = lightOnSky(short.detect, skyGrid);
  assert.ok(Math.abs(sky.offArcsec - Math.hypot(1.1, 0.65) * 6.15) < 0.05, `off ${sky.offArcsec}`);
  // a Gaia source at the light centre explains it; one 10″ from the light does not
  const [lra, ldec] = sky.light;
  const rows = [{ id: 'far', ra: lra + 10 / 3600, dec: ldec, g: 12 }, { id: 'bg', ra: lra + 0.5 / 3600, dec: ldec, g: 16.31 }];
  const src = pickSource(rows, sky);
  assert.equal(src.id, 'bg');
  assert.match(notHereText(short.detect, sky, src), /^Not detected here: the light is a background star \(Gaia G 16\.3, 7\.\d″ away\)$/);
  assert.match(notHereText(short.detect, sky, src, 'WISE 0855', 'below 3.8 µm'), /^Not detected here: the light is a background star \(Gaia G 16\.3, 7\.\d″ away\); WISE 0855 is too faint below 3\.8 µm\. That star sits inside the 15″ measuring circle at every wavelength, so the 3\.8–5\.0 µm light is WISE 0855 blended with some of that star's light\.$/);
  assert.equal(pickSource([rows[0]], sky), null);
  // Gaia not answering: the Proof page's saved cone (distances from the target only)
  assert.deepEqual(pickSaved([{ id: 'a', g: 16.31, sepArcsec: 7.8 }, { id: 'b', g: 14, sepArcsec: 14.6 }], sky), { id: 'a', g: 16.31, sepArcsec: 7.8 });
  assert.equal(pickSaved([{ id: 'b', g: 14, sepArcsec: 14.6 }], sky), null);
  assert.equal(notHereText(short.detect, sky, null), `Not detected here: the light in the aperture is centred ${sky.offArcsec.toFixed(1)}″ away, on another source`);
});

test('a3: no light at the position at all is "not detected here"; a steady star on target is detected', () => {
  const lc = lightcurve(measure(seasons3((s, det) => (det === 2 ? 0 : 1000)), skyGrid));
  assert.equal(lc.groups[0].detect.state, 'faint');
  assert.equal(notHereText(lc.groups[0].detect), 'Not detected here: no light above the noise at its position');
  assert.equal(lc.groups[1].detect.state, 'ok');
  for (const g of lightcurve(measure(seasons3(() => 1000), grid)).groups) { assert.equal(g.detect.state, 'ok'); assert.ok(g.detect.offPx < 0.01); }
  const none = lightcurve(measure(seasons3(() => 1000, { starOf: () => [C + 1.5, C] }), skyGrid));
  assert.equal(none.status, 'absent');
  assert.equal(message(none, 'X'), 'X is not detected at its predicted position in these SPHEREx images, so its brightness cannot be measured.');
});

test('seasons split at gaps of 60 days, wording and groups match the Proof page', () => {
  assert.deepEqual(seasonIndex([10, 0, 69, 130, 400]), [0, 0, 0, 1, 2]);
  assert.deepEqual(GROUPS.map(g => g.dets), [[1, 2, 3, 4], [5, 6]]);
  assert.equal(CAPTION, 'Aperture photometry on single images, not calibrated.');
  assert.equal(fmtMag(-0.304), '−0.30'); assert.equal(fmtMag(0.7251), '+0.73');
});

test('Clean Blink: overlays off, image untouched, target centred', () => {
  const o = { ramp: 'copper', stretch: 'auto', ring: true, hatch: true, cell: 20 };
  assert.deepEqual(cleanOpt(o), { ramp: 'copper', stretch: 'auto', ring: false, hatch: false, cell: 20 });
  assert.equal(o.ring, true, 'settings are not changed, only skipped');
  assert.deepEqual(centrePan(25, 60, 12, 12), { panX: 0, panY: 0 });
  assert.deepEqual(centrePan(25, 60, 13, 11), { panX: -60, panY: 60 });
  assert.deepEqual(centrePan(25, 10, 500, 12), { panX: -125, panY: 0 }, 'clamped like the drag pan');
});
