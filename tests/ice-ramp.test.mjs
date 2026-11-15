// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// The default look draws images with the ice ramp (no copper), whose luminance rises strictly; the classic look keeps copper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load(look) {
  const html = { dataset: look ? { axLook: look } : {} };
  const ctx = { window: { matchMedia: () => ({ matches: false }) }, document: { documentElement: html } };
  vm.runInNewContext(readFileSync(new URL('../web/app/erender.js', import.meta.url), 'utf8'), ctx);
  return { R: ctx.window.MockRender, html };
}
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

test('default look picks the ice ramp for the copper setting', () => {
  for (const look of ['volt', undefined]) {
    const { R } = load(look);
    assert.equal(R.lookRamp('copper'), 'ice');
    assert.equal(R.lookRamp('neutral'), 'neutral'); // the Grey choice is left alone
    assert.match(R.rampCss('copper'), /rgb\(5,11,26\)/);
    assert.doesNotMatch(R.rampCss('copper'), /176,100,48/);
    assert.notEqual(R.NO_DATA, '#100D0B');
    assert.equal(R.crossColor(), 'rgba(255,255,255,.7)');
  }
});

test('ice ramp: the five asked-for stops, luminance rising strictly', () => {
  const { R } = load('volt');
  const hex = R.ramps.ice.map(([, c]) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase());
  assert.deepEqual([...hex], ['#050B1A', '#0E2A6B', '#2F6BE0', '#A9DBFF', '#FFFFFF']);
  let prev = -1;
  for (let i = 0; i <= 200; i++) {
    const L = lum(R.rampRGB('ice', i / 200));
    assert.ok(L > prev, `luminance must rise at t=${i / 200}`);
    prev = L;
  }
});

test('classic look keeps copper, and the look is read live', () => {
  const { R, html } = load('classic');
  assert.equal(R.lookRamp('copper'), 'copper');
  assert.equal(R.NO_DATA, '#100D0B');
  html.dataset.axLook = 'volt';
  assert.equal(R.lookRamp('copper'), 'ice');
});
