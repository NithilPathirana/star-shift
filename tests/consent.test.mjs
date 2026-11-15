// Consent gating of browser storage and the per-tool tutorial store (spec design/spec-tutorials-consent.md).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TUTORIAL_KEY, readTutorials, needsTutorial, markTutorial, resetTutorials, isDeepLink } from '../web/app/tour/progress.js';

const src = readFileSync(new URL('../web/app/consent.js', import.meta.url), 'utf8');
const ctx = {}; vm.createContext(ctx); vm.runInContext(src, ctx);
const SC = ctx.StarShiftConsent;

// a Map-backed storage in the raw shape the gate takes, plus a Storage-like face for progress.js
function mem() {
  const m = new Map();
  return { m, get: k => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, String(v)), remove: k => m.delete(k), keys: () => [...m.keys()],
    getItem(k) { return this.get(k); }, setItem(k, v) { this.set(k, v); }, removeItem(k) { this.remove(k); } };
}
const OPTIONAL = ['tgi-bands-v2', 'tgi-mapbands-v1', 'tgi-flags-v1', 'spherex-viewer.bands.v2', 'star-shift-lab-notebooks-v1'];

test('before consent, optional keys are never written to localStorage (this visit only, in sessionStorage)', () => {
  const L = mem(), S = mem(), g = SC.createGate(L, S);
  assert.equal(g.decided(), false);
  for (const k of OPTIONAL) { g.set(k, '{"x":1}'); assert.equal(L.get(k), null, k); assert.equal(g.get(k), '{"x":1}', k); }
  g.set('star-shift-expert-v1', 'on'); g.set(SC.TUTORIAL_KEY, '{"map":"done"}');
  assert.equal(L.get('star-shift-expert-v1'), 'on'); assert.equal(L.get(SC.TUTORIAL_KEY), '{"map":"done"}');
  assert.deepEqual(L.keys().sort(), ['star-shift-expert-v1', SC.TUTORIAL_KEY].sort());
});

test('mixed keys keep only their necessary fields (text size, comfort) in localStorage before consent', () => {
  const L = mem(), S = mem(), g = SC.createGate(L, S);
  g.set('tgi-clarity-v1', JSON.stringify({ motion: true, text: true, ramp: 'neutral', str: 'strong', sounds: true }));
  assert.deepEqual(JSON.parse(L.get('tgi-clarity-v1')), { motion: true, text: true });
  assert.deepEqual(JSON.parse(g.get('tgi-clarity-v1')), { motion: true, text: true, ramp: 'neutral', str: 'strong', sounds: true });
  g.set('star-shift-access-v1', JSON.stringify({ preset: 'rg', p: '#000000', imgHue: '#ffffff', bold: true, leading: 'loose' }));
  assert.deepEqual(JSON.parse(L.get('star-shift-access-v1')), { bold: true, leading: 'loose' });
});

test('Accept keeps this visit\'s choices from now on; later writes go straight to localStorage', () => {
  const L = mem(), S = mem(), g = SC.createGate(L, S, () => 'T');
  g.set('tgi-flags-v1', 'a'); g.set('tgi-clarity-v1', '{"text":true,"ramp":"neutral"}');
  g.accept();
  assert.deepEqual(JSON.parse(L.get(SC.CONSENT_KEY)), { v: 1, personal: true, at: 'T' });
  assert.equal(L.get('tgi-flags-v1'), 'a'); assert.equal(L.get('tgi-clarity-v1'), '{"text":true,"ramp":"neutral"}');
  assert.equal(S.keys().filter(k => k.startsWith(SC.VISIT)).length, 0);
  g.set('tgi-bands-v2', 'b'); assert.equal(L.get('tgi-bands-v2'), 'b');
});

test('Reject and withdrawing delete the optional keys and strip the mixed ones; necessary keys stay', () => {
  const L = mem(), S = mem(), g = SC.createGate(L, S);
  g.accept();
  for (const k of OPTIONAL) g.set(k, 'x');
  g.set('tgi-clarity-v1', '{"text":true,"ramp":"neutral"}'); g.set('star-shift-expert-v1', 'on'); g.set(SC.TUTORIAL_KEY, '{}');
  const moved = g.reject(); // withdraw
  for (const k of OPTIONAL) assert.equal(L.get(k), null, k);
  assert.deepEqual([...moved].sort(), [...OPTIONAL, 'tgi-clarity-v1'].sort());
  assert.equal(L.get('tgi-clarity-v1'), '{"text":true}');
  assert.equal(L.get('star-shift-expert-v1'), 'on'); assert.equal(L.get(SC.TUTORIAL_KEY), '{}');
  assert.equal(g.decided(), true); assert.equal(g.personal(), false);
  g.set('tgi-flags-v1', 'y'); assert.equal(L.get('tgi-flags-v1'), null); // still not written after a Reject
});

test('Reject never silently deletes: an existing notebook keeps working for this visit, only the persistent copy goes', () => {
  const L = mem(), S = mem();
  const nb = JSON.stringify({ version: 1, activeId: 'a', notebooks: [{ id: 'a', name: 'Mine', entries: [{ label: 'x' }] }] });
  L.set('star-shift-lab-notebooks-v1', nb); L.set('tgi-clarity-v1', '{"text":true,"ramp":"neutral"}'); // saved before consent existed
  const g = SC.createGate(L, S);
  assert.equal(g.get('star-shift-lab-notebooks-v1'), nb); // undecided: still readable
  const moved = g.reject();
  assert.ok(moved.includes('star-shift-lab-notebooks-v1'));
  assert.equal(L.get('star-shift-lab-notebooks-v1'), null);                 // persistent key removed
  assert.equal(g.get('star-shift-lab-notebooks-v1'), nb);                   // still there for this visit
  assert.equal(g.get('tgi-clarity-v1'), '{"text":true,"ramp":"neutral"}'); // full value for this visit
  assert.equal(L.get('tgi-clarity-v1'), '{"text":true}');                   // only the necessary part persists
  assert.deepEqual(g.visitOnly().sort(), ['star-shift-lab-notebooks-v1', 'tgi-clarity-v1']);
  // a newer value written this visit is not overwritten by the older stored one
  const L2 = mem(), S2 = mem(); L2.set('tgi-flags-v1', 'old'); const g2 = SC.createGate(L2, S2);
  g2.set('tgi-flags-v1', 'new'); g2.reject(); assert.equal(g2.get('tgi-flags-v1'), 'new');
  // accepting again later brings this visit's data back to storage
  g.accept(); assert.equal(L.get('star-shift-lab-notebooks-v1'), nb); assert.deepEqual(g.visitOnly(), []);
});

test('a stored consent survives a reload; Clear all removes everything', () => {
  const L = mem(), S = mem();
  SC.createGate(L, S).accept();
  const g2 = SC.createGate(L, S); assert.equal(g2.personal(), true);
  g2.set('tgi-flags-v1', 'z'); g2.clearAll();
  assert.equal(L.keys().length, 0); assert.equal(g2.decided(), false);
});

test('tutorial store: per tool, finished or skipped never auto-start again, replay never resets completion', () => {
  const st = mem();
  assert.equal(needsTutorial(st, 'map'), true);
  assert.equal(markTutorial(st, 'map', 'skipped'), 'skipped');
  assert.equal(needsTutorial(st, 'map'), false); assert.equal(needsTutorial(st, 'viewer'), true);
  assert.equal(markTutorial(st, 'map', 'done'), 'done');       // a later replay finished: upgrade
  assert.equal(markTutorial(st, 'map', 'skipped'), 'done');    // a later replay skipped: stays done
  markTutorial(st, 'archive', 'done');
  assert.deepEqual(readTutorials(st), { map: 'done', archive: 'done' });
  assert.equal(markTutorial(st, 'map', 'bogus'), null);
  resetTutorials(st); assert.deepEqual(readTutorials(st), {}); assert.equal(st.get(TUTORIAL_KEY), null);
  assert.deepEqual(readTutorials(null), {}); assert.equal(markTutorial(null, 'map', 'done'), null);
  st.set(TUTORIAL_KEY, '[1]'); assert.deepEqual(readTutorials(st), {});
});

test('tutorial store goes through the gate as necessary storage (works whatever consent is chosen)', () => {
  const L = mem(), S = mem(), g = SC.createGate(L, S); g.reject();
  const face = { getItem: k => g.get(k), setItem: (k, v) => g.set(k, v), removeItem: k => g.remove(k) };
  markTutorial(face, 'viewer', 'done');
  assert.equal(JSON.parse(L.get(TUTORIAL_KEY)).viewer, 'done');
});

test('deep links: ?q, ra+dec, scene, mjd or a hash from outside; never from another page of the site', () => {
  for (const u of ["http://h/index.html?q=Barnard's%20Star&scene=viewer", 'http://h/?ra=1&dec=2', 'http://h/index.html#about', 'http://h/archive.html?q=WISE', 'http://h/?mjd=6']) assert.equal(isDeepLink(u, ''), true, u);
  for (const u of ['http://h/', 'http://h/proof.html', 'http://h/?cta', 'http://h/?ra=1']) assert.equal(isDeepLink(u, ''), false, u);
  assert.equal(isDeepLink('http://h/archive.html?q=WISE', 'http://h/index.html'), false);
  assert.equal(isDeepLink('http://h/archive.html?q=WISE', 'https://chat.example/'), true);
});
