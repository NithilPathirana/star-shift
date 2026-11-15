// Tests for the per-page tour chapters (web/app/tour/chapters.js): order, which target a step uses,
// progress across pages, card placement that never covers the control, and the wording rules.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, PROGRESS_KEY, chapterById, nextChapter, pageOf, chapterForPage, chapterRunsHere, pickTargets,
  counterFor, readProgress, writeProgress, clearProgress, shouldAutoResume, canResume, resumeLabel, placeClear, overlapArea }
  from '../web/app/tour/chapters.js';

const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('Quota'); }, removeItem() { throw new Error('x'); } };

test('full tour order: map, viewer, archive, spectrum, proof, asteroids, spot, your photo, tonight, notebook; 3-5 steps each', () => {
  assert.deepEqual(CHAPTERS.map(c => c.id), ['map', 'viewer', 'archive', 'spectrum', 'proof', 'neo', 'spot', 'photo', 'tonight', 'notebook']);
  for (const c of CHAPTERS) assert.ok(c.steps.length >= 3 && c.steps.length <= 5, `${c.id}: ${c.steps.length}`);
  assert.equal(nextChapter('map').id, 'viewer');
  assert.equal(nextChapter('notebook'), null);
  assert.equal(nextChapter('archive', -1).id, 'viewer');
  assert.equal(chapterById('viewer').url, "index.html?q=Barnard%27s%20Star&scene=viewer");
});

test('wording: short titles, plain sentences, no discovery claims, asteroids are predicted', () => {
  for (const c of CHAPTERS) for (const s of c.steps) {
    assert.ok(s.title.split(/\s+/).length <= 5, s.title);
    for (const b of [s.body, s.phone?.body, ...[].concat(s.alt || []).map(a => a.body)].filter(Boolean)) {
      assert.ok(!/discover|new planet|hatch|!/i.test(b), `${c.id}/${s.id}: ${b}`);
      assert.ok(b.split(/[.?](\s|$)/).filter(x => x && x.trim()).length <= 3, `${c.id}/${s.id} too long`);
    }
  }
  assert.match(chapterById('neo').steps[0].body, /predicted positions, not detections/);
});

test('which page runs which chapter', () => {
  assert.equal(pageOf('/'), 'index.html');
  assert.equal(pageOf('/web/spot.html'), 'spot.html');
  assert.equal(pageOf('/proof'), 'proof.html'); // Cloudflare's clean URLs (live)
  assert.equal(pageOf('/archive?q=Vega'), 'archive.html');
  assert.equal(pageOf('/index'), 'index.html');
  assert.equal(chapterForPage('index.html', { scene: 'map' }).id, 'map');
  assert.equal(chapterForPage('index.html', { scene: 'viewer' }).id, 'viewer');
  assert.equal(chapterForPage('neo.html').id, 'neo');
  assert.equal(chapterForPage('archive.html', { notebookOpen: true }).id, 'notebook');
  assert.equal(chapterForPage('orbits.html'), null);
  assert.ok(chapterRunsHere(chapterById('notebook'), 'spot.html'));
  assert.ok(!chapterRunsHere(chapterById('archive'), 'spot.html'));
});

test('targets: phone variant first on phones, then own, then each alt (requires checked); null skips', () => {
  const step = { targets: ['.rail .expert-sw'], body: 'own', phone: { targets: ['#ph'], body: 'phone' },
    alt: [{ targets: ['[data-rail-more]'], requires: '#pagesPop .expert-sw', body: 'more' }, { targets: ['#pagesBtn'], body: 'pages' }] };
  const shownOf = list => s => list.includes(s);
  assert.equal(pickTargets(step, { phone: true, shown: shownOf(['#ph', '.rail .expert-sw']) }).body, 'phone');
  assert.equal(pickTargets(step, { phone: false, shown: shownOf(['#ph', '.rail .expert-sw']) }).body, 'own');
  assert.equal(pickTargets(step, { shown: shownOf(['[data-rail-more]', '#pagesBtn']), exists: () => false }).body, 'pages');
  assert.equal(pickTargets(step, { shown: shownOf(['[data-rail-more]']), exists: () => true }).body, 'more');
  assert.equal(pickTargets(step, { shown: () => false }), null);
  assert.equal(pickTargets({ targets: ['#a'], title: 'T', alt: { targets: ['#b'], title: 'U' } }, { shown: s => s === '#b' }).title, 'U');
});

test('counter: chapter name and step, with the part number in the full tour', () => {
  assert.equal(counterFor(chapterById('archive'), 1, 4, false), 'Archive · 2 of 4');
  assert.equal(counterFor(chapterById('archive'), 0, 4, true), 'Part 3 of 10 · Archive · 1 of 4');
  assert.equal(counterFor(chapterById('archive'), 4, 4, true), '');
});

test('progress: saved, resumed on the page the tour loaded, offered elsewhere, safe in private mode', () => {
  const st = memStore();
  assert.equal(readProgress(st), null);
  assert.ok(writeProgress(st, { mode: 'full', chapter: 'spectrum', step: null, status: 'running', nav: true }, 1000));
  const p = readProgress(st, 2000);
  assert.equal(p.chapter, 'spectrum');
  assert.ok(shouldAutoResume(p, 'spectral.html'));
  assert.ok(!shouldAutoResume(p, 'proof.html'));
  assert.ok(!shouldAutoResume({ ...p, nav: false }, 'spectral.html'));
  assert.ok(canResume(p)); assert.equal(resumeLabel(p), 'Resume tour: Spectrum');
  assert.equal(readProgress(st, 1000 + 8 * 864e5), null, 'stale after a week');
  st.setItem(PROGRESS_KEY, '{bad json'); assert.equal(readProgress(st), null);
  st.setItem(PROGRESS_KEY, JSON.stringify({ mode: 'full', chapter: 'nope', t: Date.now() })); assert.equal(readProgress(st), null);
  assert.ok(clearProgress(st)); assert.equal(st.getItem(PROGRESS_KEY), null);
  assert.equal(readProgress(throwing), null); assert.equal(writeProgress(throwing, p), false); assert.equal(clearProgress(throwing), false);
  assert.equal(readProgress(null), null);
});

test('card placement never covers the control when any side or corner has room', () => {
  const vp = { w: 1366, h: 640 }, c = { w: 320, h: 220 };
  const targets = [
    { left: 12, top: 12, width: 64, height: 615 }, // the rail
    { left: 1054, top: 100, width: 273, height: 469 }, // a side panel
    { left: 106, top: 486, width: 719, height: 75 }, // the time bar
    { left: 97, top: 214, width: 857, height: 380 }, // a big stage
    { left: 1221, top: 21, width: 99, height: 38 }, // a top-right key
  ];
  for (const t of targets) {
    const p = placeClear(t, c, vp, ['below']);
    assert.equal(p.overlap, 0, JSON.stringify(t));
    assert.equal(overlapArea({ left: p.left, top: p.top, width: c.w, height: c.h }, t), 0);
    assert.ok(p.left >= 12 && p.top >= 12 && p.left + c.w <= vp.w - 12 && p.top + c.h <= vp.h - 12);
  }
  assert.equal(placeClear({ left: 500, top: 300, width: 40, height: 40 }, c, vp, ['right']).side, 'right');
  // nothing fits: the least overlap, never thrown
  const huge = placeClear({ left: 0, top: 0, width: 1366, height: 640 }, c, vp, []);
  assert.ok(huge.overlap > 0);
});
