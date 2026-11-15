// Tests for the 60-second tour (judges' b4) and the first-visit offer rules (a5): step order across
// pages, the counter, progress in quick mode, and when the offer may show.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUICK, QUICK_TOTAL, CHAPTERS, chapterById, nextChapter, chapterRunsHere, counterFor, pickTargets,
  readProgress, writeProgress, shouldAutoResume, canResume, resumeLabel } from '../web/app/tour/chapters.js';
import { offerAllowed, OFFER_MS, shouldOffer, remember } from '../web/app/tour/steps.js';

const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const steps = () => QUICK.flatMap(c => c.steps.map(s => `${c.page}:${s.id}`));

test('quick tour: 6 steps, pick, Play, Blink, Proof row, Spot, Notebook, ending on proof.html', () => {
  assert.equal(QUICK_TOTAL, 6);
  assert.deepEqual(steps(), ['index.html:pick', 'index.html:play', 'index.html:blink', 'proof.html:row', 'proof.html:spot', 'proof.html:notebook']);
  assert.equal(QUICK.at(-1).page, 'proof.html');
  assert.equal(chapterById('q-viewer').needs, 'viewer');
  assert.equal(chapterById('q-proof').steps[0].open, 'proof-barnard');
});

test('quick tour: chapters chain among themselves, never into the full tour', () => {
  assert.equal(nextChapter('q-pick').id, 'q-viewer');
  assert.equal(nextChapter('q-viewer').id, 'q-proof');
  assert.equal(nextChapter('q-proof'), null);
  assert.equal(nextChapter('q-viewer', -1).id, 'q-pick');
  assert.equal(nextChapter('map').id, 'viewer'); // the full tour is unchanged
  assert.equal(CHAPTERS.length, 9);
  assert.ok(chapterRunsHere(chapterById('q-proof'), 'proof.html'));
  assert.ok(!chapterRunsHere(chapterById('q-proof'), 'index.html'));
});

test('quick tour: one counter across pages, "Quick tour · k of 6"', () => {
  const seen = [];
  for (const c of QUICK) c.steps.forEach((s, i) => seen.push(counterFor(c, i, c.steps.length, false)));
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6].map(k => `Quick tour · ${k} of 6`));
});

test('quick tour: every card says what it is, what to do and what you learn, in plain words', () => {
  for (const c of QUICK) for (const s of c.steps) {
    assert.ok(s.title.split(/\s+/).length <= 5, s.title);
    for (const v of [s, ...[].concat(s.alt || [])]) {
      const L = v.lines || s.lines;
      assert.deepEqual(L.map(x => x[0]), ['What it is:', 'Do:', 'You learn:'], `${c.id}/${s.id}`);
      for (const [, t] of L) {
        assert.ok(t.length > 10 && t.length < 110, `${s.id}: ${t}`);
        assert.ok(!/discover|detected|new planet|χ|σ|±/i.test(t), `${s.id}: ${t}`);
      }
    }
  }
});

test('quick tour: on phones the Proof step outlines the row\'s top cells, keeping its lines', () => {
  const row = chapterById('q-proof').steps[0];
  const v = pickTargets(row, { phone: true, shown: () => true });
  assert.ok(v.targets.every(t => t.startsWith('tr.pf-row[data-tour-mark] ')));
  assert.equal(v.lines[0][0], 'What it is:');
});

test('quick tour: phones fall back to the Pages key for Spot and Notebook, and the variant keeps its lines', () => {
  const spot = chapterById('q-proof').steps.find(s => s.id === 'spot');
  const v = pickTargets(spot, { shown: s => s === '#pagesBtn', exists: () => true });
  assert.deepEqual(v.targets, ['#pagesBtn']);
  assert.match(v.lines[0][1], /under Pages/);
  const nb = chapterById('q-proof').steps.find(s => s.id === 'notebook');
  assert.match(pickTargets(nb, { shown: s => s === '#pagesBtn' }).lines[0][1], /under Pages/);
  assert.match(pickTargets(nb, { shown: s => s === '[data-rail-more]' }).lines[0][1], /under More/);
});

test('quick tour progress: saved in quick mode, resumed on the page it loaded, resumable when skipped', () => {
  const st = memStore();
  writeProgress(st, { mode: 'quick', chapter: 'q-proof', step: null, status: 'running', nav: true });
  const p = readProgress(st);
  assert.equal(p.mode, 'quick');
  assert.ok(shouldAutoResume(p, 'proof.html'));
  assert.ok(!shouldAutoResume(p, 'index.html'));
  writeProgress(st, { mode: 'quick', chapter: 'q-viewer', step: 'blink', status: 'paused' });
  assert.ok(canResume(readProgress(st)));
  assert.equal(resumeLabel(readProgress(st)), 'Resume tour: Quick tour');
  writeProgress(st, { mode: 'bogus', chapter: 'q-pick', status: 'running' });
  assert.equal(readProgress(st), null);
});

test('offer: not on a deep link (q, ra+dec, scene); a plain landing still gets it', () => {
  assert.equal(OFFER_MS, 8000);
  assert.ok(offerAllowed('http://127.0.0.1:8787/'));
  assert.ok(offerAllowed('http://127.0.0.1:8787/index.html'));
  assert.ok(offerAllowed('/index.html?expert=1'));
  assert.ok(!offerAllowed("http://127.0.0.1:8787/index.html?q=Barnard%27s%20Star&scene=viewer"));
  assert.ok(offerAllowed('/index.html?q=Barnard%27s+Star')); // "/" lands here: still a cold open
  assert.ok(!offerAllowed('/index.html?q=WISE%200855'));
  assert.ok(!offerAllowed('/index.html?q=Barnard%27s+Star&scene=map'));
  assert.ok(!offerAllowed('/index.html?ra=269.45&dec=4.69'));
  assert.ok(!offerAllowed('/index.html?scene=viewer'));
  assert.ok(offerAllowed('/index.html?ra=269.45')); // half a position is not a deep link
});

test('offer: once seen it is stored and never offered again', () => {
  const st = memStore();
  assert.ok(shouldOffer(st));
  assert.ok(remember(st, 'dismissed'));
  assert.ok(!shouldOffer(st));
});
