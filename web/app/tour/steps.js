// First-visit guided tour (DESIGN.md section 33): the steps and the pure rules behind them.
// No DOM access here, so tests/tour.test.mjs can run it in Node.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

/** localStorage key: set once the visitor answers the offer (or takes the tour from Help). */
export const TOUR_KEY = 'star-shift-tour-v1';
export const CHOICES = ['started', 'dismissed', 'done'];
export const PHONE_MAX = 699; // DESIGN.md section 10: phone layout is < 700 px

export const INTRO = {
  id: 'intro', title: 'Welcome to Star Shift',
  body: "Every six months, NASA's SPHEREx photographs the whole sky. Star Shift lets anyone flip through those photos, catch what moved, and prove it's real.",
  next: 'Start',
};
export const WAITING = {
  id: 'waiting', title: "Opening Barnard's Star",
  body: 'Loading its photos from the archive. The tour carries on as soon as the first ones are in.',
};
export const OUTRO = {
  id: 'outro', title: "That's it",
  body: 'Help (the ? key) has this tour and the shortcuts.', targets: ['#helpBtn'], prefer: ['below', 'left'], next: 'Done',
  alt: { targets: ['#pagesBtn'], body: 'Help, under Pages, has this tour and the shortcuts.' }, // phones: no ? key in the top bar
};

/**
 * The counted steps, in order. `scene: 'viewer'` steps need the time-lapse loaded first.
 * `when: 'notebook'` keeps a step out unless the notebook is built (window.openNotebook).
 * Titles are at most five words; bodies one or two sentences.
 */
export const STEPS = [
  { id: 'picks', scene: 'any', targets: ['.picks'], prefer: ['below', 'right', 'left'],
    title: 'Five objects to start with',
    body: "Barnard's Star, Epsilon Indi B and WISE 0855 drift across the sky between photos; RW Aurigae and R Draconis stay put but change brightness. Pick one to fly the sky map there." },
  { id: 'play', scene: 'viewer', targets: ['.transport', '.tl'], prefer: ['above', 'below'],
    title: 'Watch it move',
    // when the tour opened the time-lapse itself, bodyFor() puts "We've opened <name> for you." in front
    body: 'Play flips through every photo in date order, and the timeline groups them into observing seasons about six months apart; drag it, or use ← and → to step.' },
  { id: 'blink', scene: 'viewer', targets: ['#viewSeg'], prefer: ['above', 'below'], avoid: ['#speedSeg', '#layerSeg', '.tl'],
    title: 'Blink to catch the shift',
    body: 'Blink flips between the first and the last season, so anything that moved jumps back and forth. Compare puts the two side by side.' },
  { id: 'flags', scene: 'viewer', targets: ['.flags-split'], prefer: ['above', 'left'],
    title: 'Flags mark doubtful pixels',
    // three short sentences by the lead's wording (Sat night review); the only step allowed three
    body: 'Dark flat squares have no data; outlines and small marks are pixels the archive flagged. FLAGS shows or hides them, and the arrow beside it opens the legend.' },
  { id: 'bands', scene: 'viewer', targets: ['#bandTool'], prefer: ['right', 'above', 'below'],
    title: 'Six colour bands',
    body: 'SPHEREx sees from 0.74 to 5.01 µm, split here into six colour bands that tint the timeline and the wavelength chip. Open this key to rename, recolour or resize them.' },
  // the project's twist: only when a link to spot.html is on screen (rail), or, on phones, in the Pages sheet
  { id: 'spot', scene: 'any', targets: ['.rail a[href$="spot.html"]'], prefer: ['right', 'below', 'above'],
    title: 'Spot a mover',
    body: 'Your turn: blink a patch, click anything that moves, and the app checks it against flags, known stars and known asteroids. Then save what you found to your notebook.',
    alt: { targets: ['#pagesBtn'], requires: '#pagesPop a[href$="spot.html"]', prefer: ['below', 'left'],
      body: 'Your turn: under Pages, Spot lets you blink a patch, click anything that moves, and the app checks it against flags, known stars and known asteroids. Then save what you found to your notebook.' } },
  // scene 'viewer': its + keys live in the viewer's details, so it is counted from the start (stable "k of n")
  { id: 'notebook', scene: 'viewer', when: 'notebook', targets: ['[data-tour="notebook"]', '#nbAdd', '.nb-add'], prefer: ['below', 'left', 'above'],
    title: 'Your notebook',
    body: 'The + saves what you found, with its date and position, so you can come back to it later.' },
];

/**
 * Steps that can be shown now. env.hasNotebook: window.openNotebook exists.
 * env.isAvailable(step): its target is on screen (or, for a viewer step before the
 * time-lapse is open, at least present in the page). Missing → the step is dropped.
 */
export function filterSteps(steps, env = {}) {
  const ok = env.isAvailable || (() => true);
  return steps.filter(s => (s.when !== 'notebook' || !!env.hasNotebook) && ok(s));
}

/**
 * Which targets a step uses here: its own if one is on screen, else its `alt` (e.g. the Pages key on
 * phones, when the Pages sheet holds the link), else null (the step is dropped).
 * shown(selector) → a matching element is visible; exists(selector) → one is in the page.
 */
export function pickVariant(step, shown, exists) {
  if (!step.targets) return { targets: null, body: step.body, prefer: step.prefer };
  if (step.targets.some(shown)) return { targets: step.targets, body: step.body, prefer: step.prefer };
  const a = step.alt;
  if (a && (!a.requires || exists(a.requires)) && a.targets.some(shown)) return { targets: a.targets, body: a.body || step.body, prefer: a.prefer || step.prefer };
  return null;
}

/** The card text: step 2 says so when the tour opened the time-lapse itself. */
export function bodyFor(step, body, ctx = {}) {
  const text = body ?? step.body;
  if (step.id === 'play' && ctx.openedName) return `We've opened ${ctx.openedName} for you. ${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return text;
}

/** "2 of 5" (mono in the card). i is the 0-based index in the filtered list. */
export function counterText(i, n) {
  if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || i < 0 || i >= n) return '';
  return `${i + 1} of ${n}`;
}

/**
 * The step to show after (dir = 1) or before (dir = -1) `currentId`, using the master order in
 * `all` so it still works when the current step has since been dropped from `list`.
 * Returns null at either end (after the last step comes the outro; before the first, nothing).
 */
export function neighbour(all, list, currentId, dir) {
  const order = id => all.findIndex(s => s.id === id);
  const at = currentId === 'intro' ? -1 : currentId === 'outro' ? all.length : order(currentId);
  if (dir > 0) return list.find(s => order(s.id) > at) || null;
  for (let k = list.length - 1; k >= 0; k--) if (order(list[k].id) < at) return list[k];
  return null;
}

/** Offer the tour only if storage works and holds no answer yet (never nag when it can't remember). */
export function shouldOffer(storage) {
  if (!storage) return false;
  try { return storage.getItem(TOUR_KEY) === null; } catch { return false; }
}

/** Remember the visitor's answer. Returns false when storage is missing or throws (private mode). */
export function remember(storage, choice) {
  if (!storage || !CHOICES.includes(choice)) return false;
  try { storage.setItem(TOUR_KEY, choice); return true; } catch { return false; }
}

/**
 * Reduce motion, the same way the app decides it: the Clarity choice saved in
 * `tgi-clarity-v1` wins; otherwise the live data-motion attribute; otherwise the OS setting.
 */
export function reducedMotion({ clarityRaw = null, datasetMotion = '', osReduce = false } = {}) {
  let saved; try { saved = JSON.parse(clarityRaw || 'null'); } catch { saved = null; }
  if (saved && typeof saved.motion === 'boolean') return saved.motion;
  if (datasetMotion === 'reduce') return true;
  return !!osReduce;
}

/**
 * Where a card of size c ({w,h}) goes next to target rect t ({left,top,width,height}) in a
 * viewport vp ({w,h}). Tries `prefer` sides, then any side that fits, else the bottom-right
 * corner. Always kept `m` px inside the viewport.
 */
export function placeCard(t, c, vp, prefer = ['below', 'above', 'right', 'left'], gap = 14, m = 12) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(Math.max(lo, hi), v));
  const fits = {
    below: t.top + t.height + gap + c.h <= vp.h - m,
    above: t.top - gap - c.h >= m,
    right: t.left + t.width + gap + c.w <= vp.w - m,
    left: t.left - gap - c.w >= m,
  };
  const cx = t.left + t.width / 2 - c.w / 2, cy = t.top + t.height / 2 - c.h / 2;
  const pos = {
    below: [cx, t.top + t.height + gap], above: [cx, t.top - gap - c.h],
    right: [t.left + t.width + gap, cy], left: [t.left - gap - c.w, cy],
  };
  const side = prefer.find(s => fits[s]) || ['below', 'above', 'right', 'left'].find(s => fits[s]) || 'corner';
  const [x, y] = side === 'corner' ? [vp.w - c.w - m, vp.h - c.h - m] : pos[side];
  return { side, left: Math.round(clamp(x, m, vp.w - c.w - m)), top: Math.round(clamp(y, m, vp.h - c.h - m)) };
}

/** Union of several rects (skips empty ones); null if none. */
export function unionRect(rects) {
  const r = rects.filter(x => x && x.width > 0 && x.height > 0);
  if (!r.length) return null;
  const left = Math.min(...r.map(x => x.left)), top = Math.min(...r.map(x => x.top));
  const right = Math.max(...r.map(x => x.left + x.width)), bottom = Math.max(...r.map(x => x.top + x.height));
  return { left, top, width: right - left, height: bottom - top };
}
