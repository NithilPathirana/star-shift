// σ on every verdict badge (judging panel round 4, item 4): "AGREES 0.3σ", from the numbers the verdict uses.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { badgeText, verdictSigma, motionVerdict } from '../web/app/proof/logic.js';

const d = JSON.parse(readFileSync(new URL('../web/data/proof.json', import.meta.url), 'utf8'));
const T = (key, type) => d.targets.find(t => t.key === key).tests.find(x => x.type === type);

test('badge text: verdict then σ to one decimal; NOT MEASURABLE has none', () => {
  assert.equal(badgeText('AGREES', 0.34), 'AGREES 0.3σ');
  assert.equal(badgeText('DIFFERS', 4), 'DIFFERS 4.0σ');
  assert.equal(badgeText('NOT MEASURABLE', 2), 'NOT MEASURABLE');
  assert.equal(badgeText('AT THE LIMIT', null), 'AT THE LIMIT');
});

test('Proof badges use the verdict\'s own σ (motion: measured vs catalogue; brightness: the deciding group)', () => {
  const b = T('barnard', 'motion');
  assert.equal(badgeText(b.verdict, verdictSigma(b)), `AGREES ${b.diff.sigma.toFixed(1)}σ`);
  assert.equal(badgeText(b.direction.verdict, b.direction.sigma), `DIRECTION OFF ${b.direction.sigma.toFixed(1)}σ`);
  const r = T('rw-aur', 'brightness'), top = Math.max(...r.measured.groups.filter(g => g.ok).map(g => g.sigma));
  assert.equal(badgeText(r.verdict, verdictSigma(r)), `AGREES ${top.toFixed(1)}σ`);
  assert.ok(top > 3, 'AGREES for brightness means more than 3σ');
  assert.equal(badgeText(T('r-dra', 'motion').verdict, verdictSigma(T('r-dra', 'motion'))), 'NOT MEASURABLE');
  for (const t of d.targets) for (const x of t.tests) {
    const s = verdictSigma(x);
    if (x.verdict === 'NOT MEASURABLE') assert.equal(s, null);
    else assert.ok(Number.isFinite(s), `${t.key} ${x.type} has a σ`);
  }
});

test('the viewer\'s σ (motionVerdict on the same numbers) equals the Proof page\'s', () => {
  for (const t of d.targets) {
    const x = t.tests.find(y => y.type === 'motion');
    if (x.verdict === 'NOT MEASURABLE') continue;
    const m = { ok: true, total: x.measured.value, totalErr: x.measured.err, pmra: x.measured.pmra, pmdec: x.measured.pmdec,
      pmraErr: x.measured.pmraErr, pmdecErr: x.measured.pmdecErr, frames: x.measured.frames, maskedFrames: 0, span: x.measured.span, significant: true };
    const v = motionVerdict(m, x.expected.value, x.expected.err, x.measured.span, x.expectedVec);
    assert.equal(v.verdict, x.verdict, t.key);
    assert.equal(badgeText(v.verdict, v.sigma), badgeText(x.verdict, verdictSigma(x)), t.key);
  }
});
