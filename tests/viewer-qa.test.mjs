// Viewer QA fixes (15 Nov 2026): the shared measurability rule (R Draconis) and the per-preset
// detector selection (WISE 0855) that the viewer and the Proof page both use.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { motionMeasurability, motionDetectors, detectorText, MASKED_CORE_FRAC } from '../web/app/data.js';
import { motionVerdict } from '../web/app/proof/logic.js';
import { PRESETS, findPreset } from '../web/app/presets.js';

// R Draconis as fitted from the 120 cached images (make_proof.mjs, 14 Nov 2026): 40 positions,
// every one from an image whose centre is blanked, 25.68 ± 2.15″/yr "significant".
const rdra = { ok: true, total: 25679, totalErr: 2149, significant: true, upperLimit: 29978, frames: 40, maskedFrames: 40, inputFrames: 120, span: 0.99 };
// Barnard's Star: saturated in many images but most fitted positions have a usable core.
const barnard = { ok: true, total: 10323, totalErr: 274, significant: true, frames: 120, maskedFrames: 81, inputFrames: 120, span: 1.1 };

test('R Dra-like frames: not measurable (saturated core), with or without a catalogue motion', () => {
  const noCat = motionMeasurability(rdra); // e.g. reached by coordinates, no catalogue motion
  assert.equal(noCat.measurable, false); assert.equal(noCat.why, 'saturated'); assert.equal(noCat.saturated, true); assert.equal(noCat.maskedFrac, 1);
  const withCat = motionMeasurability(rdra, { catalogueMasYr: 21.5 });
  assert.equal(withCat.measurable, false); assert.equal(withCat.why, 'slow'); // Proof's order: slow first
  assert.equal(withCat.saturated, true); assert.ok(withCat.shiftPx < 0.01);
  // the Proof verdict uses the same rule
  assert.equal(motionVerdict(rdra, null, 0, rdra.span).verdict, 'NOT MEASURABLE');
  assert.equal(motionVerdict(rdra, null, 0, rdra.span).why, 'saturated');
  assert.equal(motionVerdict(rdra, 21.5, 4, rdra.span).why, 'slow');
});

test('saturated-core threshold: 90% of the fitted images', () => {
  assert.equal(MASKED_CORE_FRAC, 0.9);
  assert.equal(motionMeasurability({ ...rdra, frames: 40, maskedFrames: 36 }).why, 'saturated'); // 90%
  assert.equal(motionMeasurability({ ...rdra, frames: 40, maskedFrames: 35 }).measurable, true); // 87.5%
  assert.equal(motionMeasurability(barnard, { catalogueMasYr: 10393 }).measurable, true);
  assert.equal(motionVerdict(barnard, 10393, 0, barnard.span).verdict, 'AGREES');
  // a fit without the masked count (older callers) is judged on the other conditions only
  assert.equal(motionMeasurability({ ok: true, total: 5000, totalErr: 200, frames: 50, span: 1 }).measurable, true);
  assert.equal(motionMeasurability({ ok: false }).why, 'fit');
  assert.equal(motionMeasurability(null).why, 'fit');
});

test('proof.json verdicts follow the shared rule', () => {
  const d = JSON.parse(readFileSync(new URL('../web/data/proof.json', import.meta.url), 'utf8'));
  const r = d.targets.find(t => t.key === 'r-dra').tests[0];
  assert.equal(r.verdict, 'NOT MEASURABLE');
  assert.ok(r.fitAnyway && r.fitAnyway.value > 20000, 'the bogus fit is kept only as "fit anyway"');
  // the rule and the rows use the same words: "saturation flag", "centre blanked", "90% limit"
  const rule = d.rules.motion.find(([v]) => v === 'NOT MEASURABLE')[1];
  assert.match(rule, /centre is blanked .* in 90% or more of the fitted images \(the 90% limit\)/);
  assert.match(rule, /saturation flag alone does not count/);
});

test('preset detector selection: WISE 0855 on detectors 5–6, the others on all', () => {
  assert.deepEqual(motionDetectors(findPreset('WISE 0855')), [5, 6]);
  for (const p of PRESETS.filter(q => q.key !== 'wise-0855')) assert.equal(motionDetectors(p), null, p.key);
  assert.equal(motionDetectors(null), null);
  assert.equal(detectorText([5, 6]), '5–6'); assert.equal(detectorText([1, 3]), '1, 3'); assert.equal(detectorText([4]), '4');
  // the viewer's filter keeps exactly the images Proof measured WISE 0855 on
  const frames = [1, 2, 3, 4, 5, 6, 5, 6, 2].map((detector, k) => ({ detector, mjd: 60800 + k }));
  const dets = motionDetectors(findPreset('wise 0855'));
  assert.deepEqual(frames.filter(f => !dets || dets.includes(f.detector)).map(f => f.detector), [5, 6, 5, 6]);
  const d = JSON.parse(readFileSync(new URL('../web/data/proof.json', import.meta.url), 'utf8'));
  const w = d.targets.find(t => t.key === 'wise-0855').tests[0];
  assert.deepEqual(w.measured.detectors, dets);
  assert.equal(w.measured.bands, 'detectors 5–6 only');
});
