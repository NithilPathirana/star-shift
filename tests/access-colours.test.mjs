// Colours and accessibility: the three colour pickers set the CSS variables, and a key filled with a picked colour gets
// dark or light lettering by contrast (Nithil, Sun 15 Nov 2026: "individually change primary, secondary, and tertiary colors").
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../web/app/access.js', import.meta.url), 'utf8');

/** Runs access.js in a tiny fake page. Returns the window, the <html> stand-in and the fake storage. */
function load(saved) {
  const store = new Map(saved ? [['star-shift-access-v1', JSON.stringify(saved)]] : []);
  const vars = new Map();
  const root = {
    dataset: {}, style: { setProperty: (n, v) => vars.set(n, v), removeProperty: (n) => vars.delete(n) },
    dispatchEvent() {}, vars,
  };
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, parentNode: null });
  const document = {
    documentElement: root, readyState: 'complete', head: { appendChild() {} }, body: { appendChild() {} },
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {},
  };
  const win = {
    document, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    addEventListener() {}, Node: { DOCUMENT_POSITION_FOLLOWING: 4 }, Math, JSON, String, parseInt,
  };
  win.window = win;
  vm.runInNewContext(SRC, win);
  return { win, root, store };
}

test('default look: no colour variables set, the neon-yellow key stays (data-ax-p=off)', () => {
  const { root } = load();
  assert.equal(root.vars.size, 0);
  assert.equal(root.dataset.axColors, 'off');
  assert.equal(root.dataset.axP, 'off');
});

test('a dark red primary sets the key, link and ring variables, with light lettering on the key', () => {
  const { win, root } = load({ preset: 'custom', look: 'volt', p: '#8B1A1A', s: '#46604A', t: '#A4452F' });
  assert.equal(root.dataset.axP, 'on');
  for (const n of ['--copper', '--copper-ink', '--copper-key', '--ax-key-hi', '--on-copper', '--focus', '--ring']) assert.ok(root.vars.has(n), n);
  assert.equal(root.vars.get('--on-copper'), '#FCFDFF');
  assert.ok(!root.vars.has('--sage') && !root.vars.has('--coral'), 'secondary and tertiary untouched');
  const A = win.StarShiftAccess, c = A.contrast(A.hex2rgb(root.vars.get('--copper-key')), A.hex2rgb('#FCFDFF'));
  assert.ok(c >= 4.5, 'label contrast ' + c);
});

test('a light primary (neon yellow) keeps its colour on the key and switches to dark lettering', () => {
  const { win, root } = load({ preset: 'custom', look: 'volt', p: '#EAF42F', s: '#46604A', t: '#A4452F' });
  assert.equal(root.vars.get('--on-copper'), '#0A1238');
  const A = win.StarShiftAccess, key = A.hex2rgb(root.vars.get('--copper-key'));
  assert.ok(key[0] > 200 && key[1] > 200 && key[2] < 120, 'still yellow: ' + root.vars.get('--copper-key'));
  // the link colour on the light shell is darkened so text stays readable
  assert.ok(A.contrast(A.hex2rgb(root.vars.get('--copper')), A.hex2rgb('#E9E2D8')) >= 5.2);
});

test('picking only the secondary or tertiary sets their variables and leaves the main key alone', () => {
  const { root } = load({ preset: 'custom', look: 'volt', p: '#1342C2', s: '#0072B2', t: '#D55E00' });
  assert.equal(root.dataset.axP, 'off');
  assert.equal(root.dataset.axColors, 'custom');
  for (const n of ['--sage', '--sage-ink', '--cross', '--coral', '--color-danger']) assert.ok(root.vars.has(n), n);
  assert.ok(!root.vars.has('--copper-key') && !root.vars.has('--on-copper'));
});

test('keyInk: every hue and lightness gets a label at 4.5:1 or better on both ends of the key', () => {
  const { win } = load(), A = win.StarShiftAccess;
  for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) {
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const k = A.keyInk(hex), ink = A.hex2rgb(k.on);
    const worst = Math.min(A.contrast(A.hex2rgb(k.key), ink), A.contrast(A.hex2rgb(k.keyHi), ink));
    assert.ok(worst >= 4.5, hex + ' -> ' + k.key + '/' + k.keyHi + ' on ' + k.on + ' = ' + worst.toFixed(2));
  }
});
