// Tests for the "How we know" page: verdict rules and the shape of web/data/proof.json.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { motionVerdict, brightnessVerdict, sigmaApart, meanSem, along, RULES, VERDICT_CLASS } from '../web/app/proof/logic.js';
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
          const re = motionVerdict(ok(x.measured.value, x.measured.err), x.expected.value, x.expected.err, x.measured.span);
          assert.equal(re.verdict, x.verdict, t.key);
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
