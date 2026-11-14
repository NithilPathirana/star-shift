// Band labels for the current image: a band is a wavelength range, never a finding.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bandLabel, bandName, bandRangeText, DEFAULT_BANDS } from '../web/app/bands.js';

const byId = id => ({ ...DEFAULT_BANDS.find(b => b.id === id) });

test('default bands read as ranges, with a "Not a detection." tooltip', () => {
  assert.deepEqual(bandLabel(byId('d-co2ice')), {
    name: 'CO₂-ice band', range: '3.82–4.42 µm', text: 'CO₂-ice band · 3.82–4.42 µm',
    tip: 'The wavelength range where CO₂ ice absorbs light. Not a detection.',
  });
  assert.equal(bandLabel(byId('d-waterice')).text, 'Water-ice band · 2.42–3.82 µm');
  assert.equal(bandLabel(byId('d-browndwarfs')).text, 'Brown-dwarf band · 4.42–5.01 µm');
  for (const b of DEFAULT_BANDS) {
    const l = bandLabel(b);
    assert.match(l.text, /band · \d\.\d\d–\d\.\d\d µm$/, b.id);
    assert.match(l.tip, /^The wavelength range .*Not a detection\.$/, b.id);
  }
});

test('user bands get the generic "<name> band · a–b µm" wording', () => {
  const mine = { id: 'r1', name: 'My dust', min: 2, max: 2.5 };
  assert.equal(bandLabel(mine).text, 'My dust band · 2.00–2.50 µm');
  assert.match(bandLabel(mine).tip, /2\.00–2\.50 µm range you named “My dust”\. A wavelength range, not a detection\./);
  assert.equal(bandName({ id: 'r2', name: 'Methane band', min: 3, max: 3.5 }), 'Methane band'); // no "band band"
  // a renamed default is the user's band now: no ice wording
  assert.equal(bandLabel({ ...byId('d-co2ice'), name: 'Hot dust' }).text, 'Hot dust band · 3.82–4.42 µm');
  // a resized default keeps its meaning, and the label shows the new range
  assert.equal(bandLabel({ ...byId('d-co2ice'), min: 4.0 }).text, 'CO₂-ice band · 4.00–4.42 µm');
  assert.equal(bandRangeText({ min: 0.74, max: 1.11 }), '0.74–1.11 µm');
  assert.equal(bandLabel(null), null);
});

test('viewer: no placeholder band note, notebook hooks present', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /placeholders/i);
  assert.match(html, /id="nbAdd"/);
  const ui = readFileSync(new URL('../web/app/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /window\.openNotebook = openNotebook/);
  assert.match(ui, /bandLabel\(/);
});
