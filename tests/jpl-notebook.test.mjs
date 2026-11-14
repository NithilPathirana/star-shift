// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotebookStore } from '../web/app/notebook/store.js';
import { serializeTemplate } from '../web/app/notebook/template.js';
import { notebookToMarkdown } from '../web/app/notebook/export.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function ids() {
  let next = 0;
  return () => `id-${++next}`;
}

test('notebook store persists multiple notebooks, entries, rename and delete', () => {
  const storage = memoryStorage();
  const options = { storage, key: 'test', now: () => '2026-11-14T12:00:00.000Z', id: ids() };
  const store = createNotebookStore(options);
  const firstId = store.current().id;
  store.addEntry({ label: 'Motion', value: 12.4, unit: '″/h', source: 'NASA/JPL SB Identification', tag: 'JPL', context: { url: 'neo.html?ra=1&dec=2' } });
  const second = store.create('Comet check');
  store.rename(second.id, 'Comet follow-up');
  assert.equal(store.snapshot().notebooks.length, 2);
  assert.equal(store.current().name, 'Comet follow-up');
  store.select(firstId);
  assert.equal(store.current().entries[0].value, 12.4);
  store.delete(second.id);
  assert.equal(store.snapshot().notebooks.length, 1);

  const restored = createNotebookStore({ ...options, id: ids() });
  assert.equal(restored.current().entries[0].source, 'NASA/JPL SB Identification');
});

test('notebook store remains usable when localStorage is blocked', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const store = createNotebookStore({ storage: blocked, id: ids(), now: () => '2026-11-14T12:00:00.000Z' });
  store.addEntry({ label: 'Flags', value: 3 });
  assert.equal(store.current().entries.length, 1);
  assert.equal(store.current().entries[0].label, 'Flags');
});

test('template serialiser preserves the scientific question chain', () => {
  const markdown = serializeTemplate({ observation: 'The point moved.', hypothesis: 'It is a nearby asteroid.', test: 'Time-lapse' });
  const headings = ['Observation', 'Question', 'Hypothesis', 'Prediction', 'Test', 'Result', 'Conclusion'];
  let previous = -1;
  for (const heading of headings) {
    const index = markdown.indexOf(`### ${heading}`);
    assert.ok(index > previous, `${heading} should be in order`);
    previous = index;
  }
  assert.match(markdown, /The point moved\./);
  assert.match(markdown, /_Not recorded\._/);
});

test('Markdown export includes exact-view links and a deduplicated citation block', () => {
  const notebook = {
    name: 'Moving point', notes: 'Check the next frame.', template: { observation: 'Motion seen.' },
    entries: [
      { label: 'RA rate', value: 5, unit: '″/h', uncertainty: 0.2, source: 'NASA/JPL SB Identification', tag: 'JPL', context: { url: 'https://example.test/index.html?frame=1' } },
      { label: 'Dec rate', value: 2, unit: '″/h', uncertainty: '', source: 'NASA/JPL SB Identification', tag: 'JPL', context: {} },
      { label: 'Flag count', value: 1, unit: '', uncertainty: '', source: 'SPHEREx archive frame', tag: 'OBSERVED', context: {} },
    ],
  };
  const markdown = notebookToMarkdown(notebook, { exportedAt: '2026-11-14T12:00:00.000Z' });
  assert.match(markdown, /\*\*RA rate:\*\* 5 ″\/h ± 0\.2 ″\/h/);
  assert.match(markdown, /\[exact view\]\(https:\/\/example\.test/);
  assert.equal(markdown.match(/^- NASA\/JPL SB Identification$/gm)?.length, 1);
  assert.match(markdown, /^## Data sources$/m);
});
