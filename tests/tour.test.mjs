// Tests for the first-visit guided tour (DESIGN.md section 33): step filtering, the counter,
// next/back order, the storage rules, reduce motion and card placement. Pure logic only.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, INTRO, OUTRO, TOUR_KEY, filterSteps, counterText, neighbour, shouldOffer, remember,
  reducedMotion, placeCard, unionRect, pickVariant, bodyFor } from '../web/app/tour/steps.js';

const ids = list => list.map(s => s.id);
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return {
  getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };

test('steps: order, with the notebook only when it is built', () => {
  assert.deepEqual(ids(filterSteps(STEPS, {})), ['picks', 'play', 'blink', 'flags', 'bands', 'spot']);
  assert.deepEqual(ids(filterSteps(STEPS, { hasNotebook: true })), ['picks', 'play', 'blink', 'flags', 'bands', 'spot', 'notebook']);
});

const sentences = t => t.split(/[.!?](\s|$)/).filter(x => x && x.trim()).length;
test('steps: titles are at most five words, bodies one or two sentences (flags: three, by the lead)', () => {
  for (const s of [...STEPS, INTRO, OUTRO]) {
    assert.ok(s.title.split(/\s+/).length <= 5, s.title);
    for (const b of [s.body, s.alt?.body].filter(Boolean)) {
      const n = sentences(b);
      assert.ok(n >= 1 && n <= (s.id === 'flags' ? 3 : 2), `${s.id}: ${n} sentences`);
      assert.ok(!/!/.test(b), 'calm: no exclamation marks');
    }
  }
  assert.match(INTRO.body, /^Every six months, NASA's SPHEREx photographs the whole sky\./);
  const flags = STEPS.find(s => s.id === 'flags');
  assert.equal(flags.body, 'Hatched squares have no data. Outlines and small marks are pixels the archive flagged. FLAGS shows or hides them, and the arrow beside it opens the legend.');
  const spot = STEPS.find(s => s.id === 'spot');
  assert.equal(spot.title, 'Spot a mover');
  assert.match(spot.body, /^Your turn: blink a patch, click anything that moves/);
});

test('step 2 says when the tour opened the time-lapse, still in two sentences', () => {
  const play = STEPS.find(s => s.id === 'play');
  assert.equal(bodyFor(play, play.body, {}), play.body);
  const b = bodyFor(play, play.body, { openedName: "Barnard's Star" });
  assert.ok(b.startsWith("We've opened Barnard's Star for you. Play flips"));
  assert.equal(sentences(b), 2);
  assert.equal(bodyFor(STEPS[0], STEPS[0].body, { openedName: 'X' }), STEPS[0].body); // only step 2
});

test('spot step: rail link when shown, else the Pages key when the sheet holds the link, else dropped', () => {
  const spot = STEPS.find(s => s.id === 'spot');
  const rail = '.rail a[href$="spot.html"]', pagesLink = '#pagesPop a[href$="spot.html"]';
  const desk = pickVariant(spot, sel => sel === rail, () => true);
  assert.deepEqual(desk.targets, [rail]); assert.equal(desk.body, spot.body);
  const phone = pickVariant(spot, sel => sel === '#pagesBtn', sel => sel === pagesLink);
  assert.deepEqual(phone.targets, ['#pagesBtn']); assert.match(phone.body, /under Pages, Spot/);
  assert.equal(pickVariant(spot, sel => sel === '#pagesBtn', () => false), null); // no Spot link anywhere
  assert.equal(pickVariant(spot, () => false, () => true), null);
  // the last card points at Pages on phones, where the top bar has no ? key
  assert.match(pickVariant(OUTRO, sel => sel === '#pagesBtn', () => true).body, /under Pages/);
  assert.match(pickVariant(OUTRO, sel => sel === '#helpBtn', () => true).body, /the \? key/);
  // the step list (and counter) shrink when it is dropped
  const list = filterSteps(STEPS, { isAvailable: s => s.id !== 'spot' });
  assert.equal(counterText(list.length - 1, list.length), '5 of 5');
});

test('steps: a step whose target is missing or hidden is dropped and the counter shrinks', () => {
  const list = filterSteps(STEPS, { isAvailable: s => s.id !== 'bands' });
  assert.deepEqual(ids(list), ['picks', 'play', 'blink', 'flags', 'spot']);
  assert.equal(counterText(list.length - 1, list.length), '5 of 5');
  assert.equal(filterSteps(STEPS, { hasNotebook: true, isAvailable: s => s.id !== 'notebook' }).length, 6);
});

test('counter: "k of n", empty for out-of-range input', () => {
  assert.equal(counterText(0, 5), '1 of 5');
  assert.equal(counterText(4, 5), '5 of 5');
  assert.equal(counterText(5, 5), '');
  assert.equal(counterText(-1, 5), '');
  assert.equal(counterText(0, 0), '');
});

test('neighbour: next/back follow the master order, even after the current step was dropped', () => {
  const all = filterSteps(STEPS, {}), noBlink = all.filter(s => s.id !== 'blink');
  assert.equal(neighbour(STEPS, all, 'intro', 1).id, 'picks');
  assert.equal(neighbour(STEPS, all, 'picks', 1).id, 'play');
  assert.equal(neighbour(STEPS, all, 'picks', -1), null); // nothing before step 1
  assert.equal(neighbour(STEPS, all, 'spot', 1), null);  // then the outro
  assert.equal(neighbour(STEPS, noBlink, 'blink', 1).id, 'flags');
  assert.equal(neighbour(STEPS, noBlink, 'blink', -1).id, 'play');
  assert.equal(neighbour(STEPS, all, 'outro', -1).id, 'spot');
});

test('storage: offered only on a first visit; any answer stops it', () => {
  const s = memStore();
  assert.equal(shouldOffer(s), true);
  for (const choice of ['started', 'dismissed', 'done']) {
    const t = memStore(); assert.equal(remember(t, choice), true);
    assert.equal(t.m.get(TOUR_KEY), choice); assert.equal(shouldOffer(t), false);
  }
  assert.equal(remember(s, 'whatever'), false); assert.equal(shouldOffer(s), true); // unknown answers are not stored
  assert.equal(shouldOffer(memStore({ [TOUR_KEY]: '' })), false);
});

test('storage: never offered when storage is missing or throws (it could not remember the answer)', () => {
  assert.equal(shouldOffer(null), false);
  assert.equal(shouldOffer(throwing), false);
  assert.equal(remember(throwing, 'done'), false);
  assert.equal(remember(null, 'done'), false);
});

test('reduce motion: the saved Clarity choice wins, then data-motion, then the OS', () => {
  assert.equal(reducedMotion({ clarityRaw: '{"motion":true}', datasetMotion: 'full', osReduce: false }), true);
  assert.equal(reducedMotion({ clarityRaw: '{"motion":false}', datasetMotion: 'full', osReduce: true }), false);
  assert.equal(reducedMotion({ clarityRaw: null, datasetMotion: 'reduce' }), true);
  assert.equal(reducedMotion({ clarityRaw: '{"sound":true}', datasetMotion: 'full', osReduce: true }), true);
  assert.equal(reducedMotion({ clarityRaw: 'not json', osReduce: false }), false);
  assert.equal(reducedMotion(), false);
});

test('placement: preferred side when it fits, another side when not, always inside the viewport', () => {
  const vp = { w: 1366, h: 768 }, c = { w: 320, h: 160 };
  const dock = { left: 100, top: 660, width: 400, height: 80 };
  const p = placeCard(dock, c, vp, ['above', 'below']);
  assert.equal(p.side, 'above'); assert.equal(p.top, 660 - 14 - 160);
  const top = { left: 300, top: 10, width: 500, height: 44 };
  assert.equal(placeCard(top, c, vp, ['above', 'below']).side, 'below'); // no room above
  const tool = { left: 80, top: 200, width: 52, height: 52 };
  const r = placeCard(tool, c, vp, ['right']); assert.equal(r.side, 'right'); assert.equal(r.left, 80 + 52 + 14);
  const edge = placeCard({ left: 1340, top: 300, width: 20, height: 20 }, c, vp, ['below']);
  assert.ok(edge.left + c.w <= vp.w - 12 && edge.left >= 12);
  const huge = placeCard({ left: 0, top: 0, width: 1366, height: 768 }, c, vp);
  assert.equal(huge.side, 'corner'); assert.ok(huge.top >= 12 && huge.left >= 12);
});

test('unionRect: spans several targets, ignores empty ones', () => {
  assert.deepEqual(unionRect([{ left: 10, top: 20, width: 30, height: 10 }, { left: 50, top: 5, width: 10, height: 10 }, { left: 0, top: 0, width: 0, height: 0 }]),
    { left: 10, top: 5, width: 50, height: 25 });
  assert.equal(unionRect([]), null);
});

// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
test('steps: the notebook step is a viewer step, so it is counted from the start ("k of n" stays put)', () => {
  const nb = STEPS.find(s => s.id === 'notebook');
  assert.equal(nb.scene, 'viewer');
});
test('steps: the bands step gives the full range, 0.74 to 5.01 µm', () => {
  assert.match(STEPS.find(s => s.id === 'bands').body, /0\.74 to 5\.01 µm/);
});
