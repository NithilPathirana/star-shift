// Tests for the "How we know" page: verdict rules and the shape of web/data/proof.json.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { motionVerdict, brightnessVerdict, sigmaApart, meanSem, along, RULES, VERDICT_CLASS, directionVerdict, sigma2dTo1d, chi2dFor, sigmaFromP, agreeWindow } from '../web/app/proof/logic.js';
import { motionPA } from '../web/app/kinematics.js';
import { PRESETS } from '../web/app/presets.js';

const ok = (total, totalErr) => ({ ok: true, total, totalErr });

test('motion verdict: sigma thresholds', () => {
  // 10393 mas/yr catalogue, 1.1 yr: 1.86 px, measurable
  assert.equal(motionVerdict(ok(10000, 500), 10393, 0, 1.1).verdict, 'AGREES');      // 0.8σ
  assert.equal(motionVerdict(ok(9343, 500), 10393, 0, 1.1).verdict, 'AT THE LIMIT'); // 2.1σ
  assert.equal(motionVerdict(ok(9000, 500), 10393, 0, 1.1).verdict, 'AT THE LIMIT'); // 2.8σ
  assert.equal(motionVerdict(ok(8800, 500), 10393, 0, 1.1).verdict, 'DIFFERS');      // 3.2σ
  assert.equal(motionVerdict(ok(10393 + 999, 500), 10393, 0, 1.1).verdict, 'AGREES'); // 1.998σ
});

test('motion verdict: 2σ boundary and loose uncertainty', () => {
  assert.equal(motionVerdict(ok(10000, 200), 10400, 0, 1.1).verdict, 'AGREES');       // exactly 2σ: within
  assert.equal(motionVerdict(ok(10000, 199), 10400, 0, 1.1).verdict, 'AT THE LIMIT');  // just over 2σ
  // uncertainty larger than half the value -> AT THE LIMIT even when close
  const v = motionVerdict(ok(8000, 4100), 8150, 0, 1.0);
  assert.equal(v.verdict, 'AT THE LIMIT'); assert.equal(v.why, 'loose');
  // catalogue error is added in quadrature
  assert.ok(Math.abs(sigmaApart(10, 3, 0, 4) - 2) < 1e-12);
});

test('motion verdict: not measurable cases', () => {
  // RW Aur: 21.6 mas/yr over 1 yr = 0.0035 px -> not measurable even if a fit exists
  const slow = motionVerdict(ok(566, 137), 21.6, 4, 1.04);
  assert.equal(slow.verdict, 'NOT MEASURABLE'); assert.equal(slow.why, 'slow'); assert.ok(slow.shiftPx < 0.01);
  assert.equal(motionVerdict({ ok: false, reason: 'too few frames' }, 10393, 0, 1.1).verdict, 'NOT MEASURABLE');
  assert.equal(motionVerdict(null, 10393, 0, 1.1).verdict, 'NOT MEASURABLE');
  assert.equal(motionVerdict(ok(1000, 0), 10393, 0, 1.1).verdict, 'NOT MEASURABLE'); // no uncertainty, no sigma
});

test('brightness verdict', () => {
  assert.equal(brightnessVerdict({ ok: true, dmag: 0.73, dmagErr: 0.065 }, true).verdict, 'AGREES');
  assert.equal(brightnessVerdict({ ok: true, dmag: 0.25, dmagErr: 0.1 }, true).verdict, 'AT THE LIMIT');
  assert.equal(brightnessVerdict({ ok: true, dmag: 0.73, dmagErr: 0.065 }, false).verdict, 'AT THE LIMIT');
  assert.equal(brightnessVerdict(null, true).verdict, 'NOT MEASURABLE');
  assert.equal(brightnessVerdict({ ok: true, dmag: 1, dmagErr: 0 }, true).verdict, 'NOT MEASURABLE');
});

test('helpers', () => {
  const m = meanSem([1, 2, 3, NaN]);
  assert.equal(m.n, 3); assert.equal(m.mean, 2); assert.ok(Math.abs(m.sem - 1 / Math.sqrt(3)) < 1e-12);
  assert.ok(Math.abs(along(3, 4, 0) - 4) < 1e-12); assert.ok(Math.abs(along(3, 4, 90) - 3) < 1e-12);
});

test('rules: every verdict has a class, no forbidden words', () => {
  for (const [v] of [...RULES.motion, ...RULES.brightness]) assert.ok(VERDICT_CLASS[v], v);
  const text = JSON.stringify(RULES).toLowerCase();
  for (const w of ['fail', 'proves', 'score']) assert.ok(!text.includes(w), w);
});

test('proof.json: shape, every target has a row, verdicts match the rules', () => {
  const d = JSON.parse(readFileSync(new URL('../web/data/proof.json', import.meta.url), 'utf8'));
  assert.ok(!Number.isNaN(Date.parse(d.generated)));
  assert.equal(d.settings.fovArcmin, 2.5); assert.equal(d.settings.maxImages, 120);
  assert.deepEqual(d.targets.map(t => t.key), PRESETS.map(p => p.key));
  const verdicts = new Set(Object.keys(VERDICT_CLASS));
  for (const t of d.targets) {
    assert.ok(t.tests.length >= 1, t.key);
    assert.match(t.viewer, /^index\.html\?q=.+&scene=viewer$/);
    assert.ok(t.images.loaded > 0 && t.images.loaded <= 120, t.key);
    for (const x of t.tests) {
      assert.ok(verdicts.has(x.verdict), `${t.key} ${x.verdict}`);
      assert.ok(typeof x.limit === 'string' && x.limit.length > 20, `${t.key} limit`);
      assert.ok(!/proves|\bfail/i.test(x.limit), `${t.key} wording`);
      if (x.type === 'motion') {
        assert.ok(x.expected.value > 0 && x.expected.unit === 'mas/yr');
        if (x.verdict !== 'NOT MEASURABLE') {
          // the stored verdict is what the rule gives for the stored numbers
          const mm = { ...ok(x.measured.value, x.measured.err), pmra: x.measured.pmra, pmdec: x.measured.pmdec, pmraErr: x.measured.pmraErr, pmdecErr: x.measured.pmdecErr };
          const re = motionVerdict(mm, x.expected.value, x.expected.err, x.measured.span, x.expectedVec);
          assert.equal(re.verdict, x.verdict, t.key);
          // direction: its own chip, from the same numbers; never AGREES over 2σ
          assert.ok(x.direction, `${t.key} direction`);
          assert.equal(re.direction.verdict, x.direction.verdict, `${t.key} direction verdict`);
          assert.ok(Math.abs(re.direction.sigma - x.direction.sigma) < 0.1, t.key);
          if (x.direction.sigma > 2) assert.notEqual(x.direction.verdict, 'DIRECTION AGREES', t.key);
          if (x.direction.sigma > 3) assert.match(x.limit, /direction is [\d.]+° off/, `${t.key}: the limit text must say the direction is off`);
          // the grey window contains the catalogue speed and is the 2σ band of the speed rule
          assert.ok(x.window.lo < x.expected.value && x.expected.value < x.window.hi, t.key);
          assert.ok(Math.abs((x.window.hi - x.window.lo) / 4 - Math.hypot(x.measured.err, x.expected.err)) < 1, t.key);
          // each row names its floor
          assert.match(x.measured.floorText, /^floor \d\.\d\d″\/yr from (\d+ field stars|field stars \(all five fields; \d+ usable here\))$/, t.key);
          assert.ok(x.chart.points.length === x.measured.frames, `${t.key} chart points`);
          assert.ok(x.diff && Number.isFinite(x.diff.sigma));
        } else assert.equal(x.diff, null);
      } else {
        assert.equal(x.type, 'brightness');
        if (x.measured) assert.ok(x.measured.groups.every(g => !g.ok || (g.err > 0 && g.seasons.length >= 2)));
      }
    }
  }
});

// Direction check (Judging panel a7): χ over 2 degrees of freedom -> 1-D equivalent sigma.
test('direction: 2-dof chi converts to the 1-D sigma with the same tail probability', () => {
  // P(χ²₂ > χ²) = exp(−χ²/2); 2σ two-sided = 0.0455 -> χ = 2.486, 3σ = 0.0027 -> χ = 3.439
  assert.ok(Math.abs(chi2dFor(2) - 2.486) < 0.002 && Math.abs(chi2dFor(3) - 3.439) < 0.002);
  assert.ok(Math.abs(sigma2dTo1d(chi2dFor(2)) - 2) < 1e-3 && Math.abs(sigma2dTo1d(chi2dFor(3)) - 3) < 1e-3);
  assert.ok(Math.abs(sigmaFromP(0.3173) - 1) < 1e-3);
  assert.ok(sigma2dTo1d(1) < 1 && sigma2dTo1d(5) < 5); // a 2-part χ is always more likely by chance than the same 1-part σ
});

test('direction: a star moving the catalogue speed but turned sideways is caught, speed still agrees', () => {
  const cat = { pmra: -797, pmdec: 10362 }, speed = Math.hypot(cat.pmra, cat.pmdec);
  const turn = (deg) => { const pa = (motionPA(cat.pmra, cat.pmdec) + deg) * Math.PI / 180; return { pmra: speed * Math.sin(pa), pmdec: speed * Math.cos(pa) }; };
  const fit = (v, err) => ({ ok: true, total: Math.hypot(v.pmra, v.pmdec), totalErr: err, pmraErr: err, pmdecErr: err, ...v, frames: 120, maskedFrames: 0, span: 1.1 });
  // 6° sideways at 10.4″/yr = 1.09″/yr across; with 0.27″/yr per axis that is χ = 4.0 -> over 3σ
  const off = motionVerdict(fit(turn(-6), 270), speed, 0, 1.1, cat);
  assert.equal(off.verdict, 'AGREES'); assert.equal(off.direction.verdict, 'DIRECTION OFF');
  assert.ok(Math.abs(Math.abs(off.direction.side) - speed * Math.sin(6 * Math.PI / 180)) < 1);
  // 2° sideways (0.36″/yr across, χ 1.3) agrees
  assert.equal(motionVerdict(fit(turn(2), 270), speed, 0, 1.1, cat).direction.verdict, 'DIRECTION AGREES');
  // the PA window edge is exactly the 2σ line
  const w = agreeWindow(fit(cat, 270), speed, 0, cat);
  const edge = directionVerdict(fit(turn(w.paHalf), 270), cat, 0);
  assert.ok(Math.abs(edge.sigma - 2) < 0.01, String(edge.sigma));
  // without per-axis errors there is no direction verdict (old callers)
  assert.equal(motionVerdict(ok(10323, 274), speed, 0, 1.1).direction, null);
});

test('proof.json: Barnard row prints both directions, the rule counts and the floor source', () => {
  const d = JSON.parse(readFileSync(new URL('../web/data/proof.json', import.meta.url), 'utf8'));
  const b = d.targets.find(t => t.key === 'barnard').tests[0];
  assert.ok(Number.isFinite(b.direction.measured) && Number.isFinite(b.direction.catalogue));
  assert.ok(b.counts.saturationFlag > 0 && b.counts.blanked != null && b.counts.blanked / b.counts.fitted < b.counts.limitFrac);
  const r = d.targets.find(t => t.key === 'r-dra').tests[0];
  assert.ok(r.counts.blanked / r.counts.fitted >= r.counts.limitFrac, 'R Dra over the 90% limit');
  assert.equal(d.rules.direction.length, 3);
  for (const [v] of d.rules.direction) assert.ok(VERDICT_CLASS[v], v);
  assert.equal(d.settings.controlFloor, undefined); // no control-star floor (lead's decision, 15 Nov)
});

// Proof table "Why" sentences (spec-proof-flags.md 1b): generated from proof.json, never typed per target.
test('why sentence: one plain sentence per row, from proof.json numbers', async () => {
  const { whySentence } = await import('../web/app/proof/logic.js');
  const d = JSON.parse(readFileSync(new URL('../web/data/proof.json', import.meta.url), 'utf8'));
  const why = (key, type) => { const t = d.targets.find(x => x.key === key); return whySentence(t.tests.find(x => x.type === type), t, 0.7); };
  const b = d.targets.find(t => t.key === 'barnard').tests[0];
  assert.equal(why('barnard', 'motion'), `Speed matches. Direction is ${Math.abs(b.direction.paDiff).toFixed(1)}° off, most likely because the bright centre is blanked; we measure from the edges.`);
  assert.equal(why('eps-indi-b', 'motion'), 'Speed and direction both match.');
  const w = d.targets.find(t => t.key === 'wise-0855').tests[0];
  assert.equal(why('wise-0855', 'motion'), `Matches inside a wide error bar: only ${w.measured.frames} long-wavelength images show it.`);
  // the viewer's not-measurable words (commit 7affb05), blanked centre first for R Draconis
  assert.equal(why('rw-aur', 'motion'), 'Not measurable: its catalogue motion is under the 0.7″ a year we can measure.');
  assert.match(why('r-dra', 'motion'), /^Not measurable: centre blanked in \d+ of \d+ images, and its catalogue motion is under the 0\.7″ a year we can measure\.$/);
  // both wavelength groups (judging panel round 4, item 4): fainter at 3.8–5.0 µm, brighter at 0.75–3.8 µm
  assert.match(why('rw-aur', 'brightness'), /^Fainter by 0\.7\d mag at 3\.8–5\.0 µm and brighter by 0\.\d\d mag at 0\.75–3\.8 µm: a clear change at 3\.8–5\.0 µm only\.$/);
  assert.match(why('r-dra', 'brightness'), /^Too bright to measure: its centre is saturated in /);
  for (const t of d.targets) for (const x of t.tests) {
    const s = whySentence(x, t, 0.7);
    assert.ok(s.length > 10 && s.length < 140, `${t.key} ${x.type}: ${s}`);
    assert.ok(!/[σ()[\]]|±/.test(s), `${t.key} ${x.type}: no σ, ± or brackets: ${s}`);
    assert.ok(!/detected|discovered|proves|\bfail/i.test(s), s);
    if (x.verdict === 'NOT MEASURABLE') assert.match(s, /^(Not measurable|Too bright to measure)/, s);
  }
});

test('why sentence: other verdicts follow the same pattern (verdict first, one reason)', async () => {
  const { whySentence } = await import('../web/app/proof/logic.js');
  const mot = (verdict, value, err, dir, extra = {}) => ({ type: 'motion', verdict, expected: { value: 10000 }, measured: { value, err, frames: 100, detectors: [1, 2, 3, 4, 5, 6] }, direction: dir, counts: { blanked: 0, fitted: 100, limitFrac: 0.9 }, ...extra });
  assert.equal(whySentence(mot('DIFFERS', 8000, 300, { verdict: 'DIRECTION AGREES', paDiff: 1 })), 'Speed differs: 20% below the catalogue, more than the error bar allows.');
  assert.equal(whySentence(mot('AT THE LIMIT', 10700, 300, null)), 'Speed is at the limit: 7% above the catalogue.');
  assert.equal(whySentence(mot('AT THE LIMIT', 9000, 5000, null, { why: 'loose' })), 'At the limit: the error bar is more than half the measured speed.');
  assert.equal(whySentence(mot('AGREES', 10100, 300, { verdict: 'DIRECTION OFF', paDiff: -4.2 })), 'Speed matches. Direction is 4.2° off, more than the error bars allow.');
  assert.equal(whySentence(mot('AGREES', 10100, 300, { verdict: 'DIRECTION AT THE LIMIT', paDiff: 2.5 })), 'Speed matches. Direction is 2.5° off, at the limit of the error bars.');
  const br = { type: 'brightness', verdict: 'AT THE LIMIT', measured: { groups: [{ name: '0.75–3.8 µm (detectors 1–4)', ok: true, value: -0.2, err: 0.1 }, { name: '3.8–5.0 µm (detectors 5–6)', ok: false }] } };
  assert.equal(whySentence(br), 'Brighter by 0.20 mag at 0.75–3.8 µm from the first to the last season: not clearly above the noise.');
  const nm = { type: 'motion', verdict: 'NOT MEASURABLE', why: 'fit', counts: { blanked: 2, fitted: 50, limitFrac: 0.9 } };
  assert.equal(whySentence(nm), 'Not measurable: the fit could not run.');
});
