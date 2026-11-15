// Guided tour, one chapter per page (Master work order, Sun 15 Nov): the chapters, their steps
// and the pure rules behind them (order, progress, which target to use, where the card goes).
// No DOM access here, so tests/tour-chapters.test.mjs can run it in Node.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

/** localStorage key for a tour in progress (full tour across pages, or a paused page chapter). */
export const PROGRESS_KEY = 'star-shift-tour-progress';
export const DEMO_VIEWER = "index.html?q=Barnard%27s%20Star&scene=viewer";

// one line per page for the rail step (the rail's own labels)
export const RAIL_LINES = [
  ['Viewer', 'the sky map, and a time-lapse of every photo of one spot.'],
  ['Archive', 'the list of every SPHEREx photo of that spot.'],
  ['Spectrum', 'how bright it is at each infrared colour.'],
  ['Proof', 'our measurements checked against star catalogues.'],
  ['Asteroids', 'where known asteroids are predicted to be, and their orbits.'],
  ['Spot', 'hunt for a moving dot yourself.'],
  ['Tonight?', 'can you see it from where you are tonight.'],
];

const HERE = '.rail .nav-btn[aria-current="page"]';
// phones have no rail: the Pages key opens the same list; short windows fold Notebook/Help/About under More
const PAGES_ALT = { targets: ['#pagesBtn'], prefer: ['below', 'left'] };

/**
 * Chapters in full-tour order. A step: { id, targets, title, body, prefer?, list?, phone?, alt?, open? }.
 * - targets: CSS selectors; the outline goes round all that are shown. No targets: a centred card.
 * - phone: the variant used on phones (< 700 px) when its target is shown.
 * - alt: one or more fallbacks ({ targets, body?, prefer?, requires? }) when the own target is hidden.
 * - open: what the engine opens before the step (the only clicks the tour makes for the user).
 * A step whose target is missing everywhere is skipped and the counter shrinks.
 */
export const CHAPTERS = [
  { id: 'map', page: 'index.html', scene: 'map', url: 'index.html', name: 'Sky map', steps: [
    { id: 'rail', targets: ['.rail'], prefer: ['right'], title: 'The pages, on the left',
      body: 'Each key opens a page about the object you picked:', list: RAIL_LINES,
      alt: { ...PAGES_ALT, title: 'The pages', body: 'Pages, at the top, opens the other pages about the object you picked:' } },
    { id: 'search', targets: ['.topbar .search', '.picks'], prefer: ['below'], title: 'Pick something to look at',
      body: "Type a star name or sky coordinates, or click one of the five examples. Barnard's Star, Epsilon Indi B and WISE 0855 drift between photos; RW Aurigae and R Draconis change brightness instead.",
      phone: { targets: ['.topbar .search'], prefer: ['below'] } },
    { id: 'sky', targets: ['#sel'], prefer: ['right', 'left', 'below'], title: 'The sky map',
      body: 'Drag to look around and scroll to zoom; the square marks the patch you picked. Click anywhere to pick a different patch. The colours are infrared light, which your eyes cannot see.' },
    { id: 'facts', targets: ['#cdPanel .cd-head', '#cdPlay', '#cdPos'], prefer: ['left', 'below'], title: 'Facts about the patch',
      body: 'This panel says where the patch is, how often SPHEREx photographed it and how fast it moves. Click Play this patch over time to watch its photos one after another.',
      phone: { targets: ['#mdPlay'], prefer: ['above'], body: 'Play this patch over time shows its photos one after another. Below the map, a panel says where it is and how often SPHEREx photographed it.' } },
    { id: 'expert', targets: ['.rail .expert-sw'], prefer: ['right'], title: 'Simple or Expert',
      body: 'Simple, the default, explains results in plain words. Switch to Expert for exact numbers, error bars and download files; every page remembers your choice.',
      alt: [{ targets: ['[data-rail-more]'], requires: '#pagesPop .expert-sw', prefer: ['right'],
        body: 'Under More, the Expert switch shows exact numbers, error bars and download files instead of plain words. Every page remembers your choice.' },
      { ...PAGES_ALT, requires: '#pagesPop .expert-sw',
        body: 'Under Pages, the Expert switch shows exact numbers, error bars and download files instead of plain words. Every page remembers your choice.' }] },
  ] },
  { id: 'viewer', page: 'index.html', scene: 'viewer', url: DEMO_VIEWER, name: 'Time-lapse', needs: 'viewer', steps: [
    { id: 'play', targets: ['.transport', '.tl'], prefer: ['above', 'below'], title: 'Watch it move',
      body: 'Play flips through every photo in date order. Drag the time bar, or press ← and →, to step through the seasons, about six months apart.' },
    { id: 'blink', targets: ['#viewSeg'], prefer: ['above', 'below'], avoid: ['#speedSeg', '#layerSeg', '.tl'], title: 'Blink to catch the shift',
      body: 'Click Blink to flip between the first and the last season: anything that moved jumps back and forth. Compare shows the two side by side.' },
    { id: 'tools', targets: ['#tools'], prefer: ['right', 'below'], title: 'Tools beside the image',
      body: 'Zoom in and out, change the colour bands, and show the dashed ring where the star should be. Ghost slides that predicted position years into the past or future; the map key goes back to the sky map.' },
    { id: 'flags', targets: ['.flags-split'], prefer: ['above', 'right'], title: 'Flags mark doubtful pixels',
      body: 'Dark flat squares have no data; outlines and small marks are pixels the archive flagged as doubtful. FLAGS shows or hides them, and the arrow opens the legend.' },
    { id: 'panel', targets: ['#insp'], prefer: ['left'], title: 'About this photo',
      body: 'The panel gives the date, wavelength and flagged pixels of the photo on screen, and a brightness-over-time chart. The + keys save a value to your lab notebook.',
      phone: { targets: ['#infoBtn'], prefer: ['below'], body: 'This key opens the panel about the photo on screen: date, wavelength, flagged pixels and a brightness-over-time chart. Its + keys save a value to your lab notebook.' } },
  ] },
  { id: 'archive', page: 'archive.html', url: 'archive.html', name: 'Archive', steps: [
    { id: 'here', targets: [HERE], prefer: ['right'], title: 'Every photo, as a list',
      body: "The Archive lists every SPHEREx photo of this spot, straight from NASA's archive (IRSA). Use it to check exactly what the time-lapse is made of.",
      alt: { ...PAGES_ALT, body: "The Archive lists every SPHEREx photo of this spot, straight from NASA's archive (IRSA). Use it to check exactly what the time-lapse is made of." } },
    { id: 'filters', targets: ['#filters'], prefer: ['below'], title: 'Narrow it down',
      body: 'Click a chip to keep only one season, colour band, detector or kind of flag. The table and its count change at once.',
      alt: { targets: ['#filtersBtn'], prefer: ['below'], body: 'Filters keeps only one season, colour band, detector or kind of flag. The table and its count change at once.' } },
    { id: 'row', targets: ['.table-well tbody tr:first-child'], prefer: ['below', 'above'], title: 'One row per photo',
      body: 'Each row is one photo: date, wavelength and how many pixels the archive flagged. Click a column name to sort, or Play to open the time-lapse at that photo.' },
    { id: 'csv', targets: ['#csv'], prefer: ['below', 'left'], title: 'Take the list with you',
      body: 'Download list (CSV) saves the table for a spreadsheet, so you can redo our sums yourself.',
      alt: { targets: ['.pager'], prefer: ['below', 'left'], title: 'Page through the list',
        body: 'Show 50, 100 or 250 rows at a time and use the arrows to page through. In Expert mode, Download list (CSV) saves the table for a spreadsheet.' } },
  ] },
  { id: 'spectrum', page: 'spectral.html', url: 'spectral.html', name: 'Spectrum', steps: [
    { id: 'here', targets: [HERE], prefer: ['right'], title: 'Brightness by colour',
      body: 'A spectrum shows how bright something is at each infrared colour (wavelength). Ice and dust dim the light at their own wavelengths, so the shape hints at what is there.',
      alt: PAGES_ALT },
    { id: 'plot', targets: ['#plot'], prefer: ['below', 'right', 'left'], title: 'One dot per photo',
      body: 'Each dot is one SPHEREx photo, measured at the star; short wavelengths on the left, long on the right. Point at a dot to read its date and value.',
      phone: { targets: ['#plot'], prefer: ['below'] } },
    { id: 'more', targets: ['#perDet', '#more'], prefer: ['left', 'below'], title: 'Measure more photos',
      body: 'Pick how many photos per detector, then click Measure more images. More dots make the shape clearer but take longer.' },
    { id: 'seasons', targets: ['#seasons'], prefer: ['left', 'above'], title: 'Compare seasons',
      body: 'Turn seasons on or off to see whether the spectrum changed between visits about six months apart.' },
  ] },
  { id: 'proof', page: 'proof.html', url: 'proof.html', name: 'How we know', steps: [
    { id: 'here', targets: [HERE], prefer: ['right'], title: 'How we know',
      body: 'Here Star Shift is tested on well-known objects: what star catalogues predict is compared with what we measure in the SPHEREx photos.',
      alt: PAGES_ALT },
    { id: 'compare', targets: ['tr.pf-row:first-child .pf-exp', 'tr.pf-row:first-child .pf-meas', 'tr.pf-row:first-child .pf-diff'], prefer: ['below'],
      title: 'Expected against measured',
      body: 'Expected comes from star catalogues, Measured here from the SPHEREx photos. Expert mode adds a Difference column: how far apart the two are, counted in measurement errors (σ).' },
    { id: 'verdict', targets: ['tr.pf-row:first-child .pf-ver'], prefer: ['below', 'left'], title: 'The verdict',
      body: 'Each object gets AGREES, AT THE LIMIT, DIFFERS or NOT MEASURABLE by the rules written under the table. A star that barely moves is honestly marked not measurable.' },
    { id: 'open', targets: ['tr.pf-row:first-child .pf-open'], prefer: ['right', 'below'], title: 'Open the evidence',
      body: "Click an object's arrow to see its positions over time and the fit. Honest limits says what could still be wrong." },
  ] },
  { id: 'neo', page: 'neo.html', url: 'neo.html', name: 'Asteroids', steps: [
    { id: 'here', targets: [HERE], prefer: ['right'], title: 'Asteroids in a field',
      body: "This page lists known asteroids and comets that NASA JPL's orbits predict inside a SPHEREx field. They are predicted positions, not detections in the photos.",
      alt: PAGES_ALT },
    { id: 'field', targets: ['#spotter-controls'], prefer: ['below', 'above'], open: 'neo-spotter', title: 'Choose a field',
      body: 'Type a sky position, a field size and dates, then click Check field. JPL works out which known objects should pass through.' },
    { id: 'table', targets: ['#spotter-table tbody tr:first-child'], prefer: ['above', 'below'], open: 'neo-spotter', title: 'Predicted in this field',
      body: 'Each row is one known object: where and when it should be, and how bright (a bigger magnitude is fainter). Show in time-lapse opens that date so you can look for it yourself.',
      alt: { targets: ['#spotter-status'], prefer: ['below'] } },
    { id: 'orbits-tab', targets: ['#orbits-tab'], prefer: ['below', 'right'], title: 'Compare orbits',
      body: 'Click Compare orbits to draw the paths of asteroids and comets round the Sun, side by side.' },
    { id: 'orbits', targets: ['#object-search'], prefer: ['below', 'above'], open: 'neo-orbits', title: 'Add objects to compare',
      body: "Type a name such as Apophis or Ceres to add it. The plot shows each orbit from above, with Earth's for scale, and the table compares their sizes and speeds." },
  ] },
  { id: 'spot', page: 'spot.html', url: 'spot.html', name: 'Spot a mover', steps: [
    { id: 'steps', targets: ['#steps'], prefer: ['below'], title: 'Four steps',
      body: 'Spot a mover walks you through Pick a field, Blink, Click a suspect and Verify. You can go back to any step.' },
    { id: 'pick', targets: ['#pick'], prefer: ['left', 'below'], title: 'Pick a field',
      body: 'Click one of the five examples, or Surprise me for a patch photographed in at least two seasons.' },
    { id: 'blink', targets: ['#stage'], prefer: ['right', 'below'], title: 'Blink and click',
      body: 'The two seasons flip back and forth. Click a dot that jumps or appears: it gets a numbered ring and becomes a suspect.',
      phone: { targets: ['#screen'], prefer: ['below'] } },
    { id: 'checks', targets: ['#side'], prefer: ['left', 'above'], title: 'Let the checks run',
      body: "For each suspect the app checks flags, known stars and known asteroids, then gives a verdict. Unexplained means worth a second look by experts, not a new object.",
      alt: [{ targets: ['#sheetOpen'], prefer: ['above'] },
        { targets: ['#steps'], prefer: ['below'], body: 'After you mark a suspect, Verify checks it against flags, known stars and known asteroids, then gives a verdict. Unexplained means worth a second look by experts, not a new object.' }] },
  ] },
  { id: 'tonight', page: 'planetarium.html', url: 'planetarium.html', name: 'Can I see it tonight?', steps: [
    { id: 'here', targets: [HERE], prefer: ['right'], title: 'Can I see it tonight?',
      body: 'This page draws the sky from a place on Earth, so you can check whether an object is up and where to look.',
      alt: PAGES_ALT },
    { id: 'place', targets: ['#placeBtn'], prefer: ['below', 'right'], title: 'Choose your place',
      body: 'Click From to pick a city, an observatory or your own location; your location stays in your browser.' },
    { id: 'look', targets: ['#zin', '#zout', '#zreset'], prefer: ['right', 'above'], title: 'Look around',
      body: 'Drag the sky to look around and zoom with these keys or the wheel. Click a star or planet to pick it.' },
    { id: 'details', targets: ['#selSec'], prefer: ['left', 'below'], title: 'Rise, set and height',
      body: 'What you picked shows here: when it rises and sets and how high it is now.',
      phone: { targets: ['#infoBtn'], prefer: ['below'], body: 'Details shows what you picked: when it rises and sets and how high it is now.' } },
    { id: 'time', targets: ['#tSlider'], prefer: ['above'], title: 'Drag the time bar',
      body: 'Drag the bar to move up to 12 hours either way, or type a date beside it. Play runs time forward and Now comes back to the present.' },
  ] },
  { id: 'notebook', page: '*', name: 'Lab notebook', steps: [
    { id: 'key', targets: ['.rail [data-notebook]'], prefer: ['right'], title: 'Your lab notebook',
      body: 'Every + key in Star Shift saves a value to the notebook, with where it came from. The tour opens it for you next.',
      alt: [{ targets: ['[data-rail-more]'], prefer: ['right'], body: 'Under More, Notebook keeps every value you save with a + key, with where it came from. The tour opens it for you next.' },
        { ...PAGES_ALT, body: 'Under Pages, Notebook keeps every value you save with a + key, with where it came from. The tour opens it for you next.' }] },
    { id: 'captured', targets: ['.notebook-dialog .notebook-content > .notebook-section:first-child > h3', '.notebook-dialog .notebook-empty',
      '.notebook-dialog .notebook-entry:first-child .notebook-entry-head', '.notebook-dialog .notebook-entry:first-child .notebook-entry-value'], prefer: ['right', 'left', 'below'], open: 'notebook', title: 'Captured values',
      body: 'Values you saved land here, each with a link back to the exact view. Drag one into the hypothesis below, or use Attach.' },
    { id: 'template', targets: ['.notebook-dialog .notebook-help', '.notebook-dialog .notebook-template-field:first-child'], prefer: ['left', 'right', 'above'], open: 'notebook', title: 'Write it up',
      body: 'The template walks you through observation, question, hypothesis, prediction, test, result and conclusion, like a lab report.',
      phone: { targets: ['.notebook-dialog .notebook-template-field:first-child'], prefer: ['below'] } },
    { id: 'keep', targets: ['.notebook-dialog .notebook-footer'], prefer: ['above'], open: 'notebook', title: 'Keep a copy',
      body: 'Export Markdown downloads the notebook and Print makes a paper copy. Until then it stays in this browser only.' },
  ] },
];

/**
 * The 60-second tour ("Start tour", judges' item b4): six steps across two pages, each card saying
 * what it is, what to do and what you learn. It ends on Proof with Barnard's Star's row marked.
 * Same step shape as the chapters; `lines` are the card's three labelled lines.
 */
const QL = (it, act, learn) => [['What it is:', it], ['Do:', act], ['You learn:', learn]];
export const QUICK = [
  { id: 'q-pick', quick: true, page: 'index.html', scene: 'map', url: 'index.html', name: 'Quick tour', steps: [
    { id: 'pick', targets: ['.picks'], prefer: ['below'], title: 'Pick a star', body: '',
      lines: QL('five objects SPHEREx photographed many times.', "click Barnard's Star, or press Next and the tour opens it.", 'some stars move across the sky fast enough to see.'),
      alt: { targets: ['.topbar .search'], prefer: ['below'] } },
  ] },
  { id: 'q-viewer', quick: true, page: 'index.html', scene: 'viewer', url: DEMO_VIEWER, needs: 'viewer', name: 'Quick tour', steps: [
    { id: 'play', targets: ['.transport', '.tl'], prefer: ['above', 'below'], title: 'Play the photos', body: '',
      lines: QL('every SPHEREx photo of this patch, in date order.', 'press Play, or drag the time bar.', "Barnard's Star creeps along while the stars behind it stay put.") },
    { id: 'blink', targets: ['#viewSeg'], prefer: ['above', 'below'], avoid: ['#speedSeg', '#layerSeg', '.tl'], title: 'Blink first and last', body: '',
      lines: QL('Blink flips between the first and the last season.', 'click Blink and look for a dot that jumps.', 'a jump means it moved; faraway stars stay still.') },
  ] },
  { id: 'q-proof', quick: true, page: 'proof.html', url: 'proof.html', name: 'Quick tour', steps: [
    { id: 'row', targets: ['tr.pf-row[data-tour-mark]'], open: 'proof-barnard', prefer: ['below', 'above'], title: 'Check it against catalogues', body: '',
      lines: QL("our measured motion for Barnard's Star beside what star catalogues expect.", 'read its verdict; the arrow opens the evidence.', 'whether the photos agree with decades of careful measurements.'),
      // phones: the stacked row is taller than the screen, so outline its top cells only (clear of the sheet)
      phone: { targets: ['tr.pf-row[data-tour-mark] .pf-obj', 'tr.pf-row[data-tour-mark] .pf-ver', 'tr.pf-row[data-tour-mark] .pf-meas'], prefer: ['below'] } },
    { id: 'spot', targets: ['.rail a[href$="spot.html"]'], prefer: ['right', 'below'], title: 'Spot a mover yourself', body: '',
      lines: QL('Spot, a page where you hunt for moving dots.', 'blink a patch and click anything that jumps.', 'the app checks flags, known stars and known asteroids before it calls anything unexplained.'),
      alt: { ...PAGES_ALT, requires: '#pagesPop a[href$="spot.html"]',
        lines: QL('Spot, under Pages, where you hunt for moving dots.', 'blink a patch and click anything that jumps.', 'the app checks flags, known stars and known asteroids before it calls anything unexplained.') } },
    { id: 'notebook', targets: ['.rail [data-notebook]'], prefer: ['right'], title: 'Keep what you find', body: '',
      lines: QL('a lab notebook; every + key saves a value into it.', 'open Notebook when you want to write up what you saw.', 'how an observation becomes a tested conclusion, like a lab report.'),
      alt: [{ targets: ['[data-rail-more]'], prefer: ['right'],
        lines: QL('a lab notebook, under More; every + key saves a value into it.', 'open Notebook when you want to write up what you saw.', 'how an observation becomes a tested conclusion, like a lab report.') },
      { ...PAGES_ALT, lines: QL('a lab notebook, under Pages; every + key saves a value into it.', 'open Notebook when you want to write up what you saw.', 'how an observation becomes a tested conclusion, like a lab report.') }] },
  ] },
];
export const QUICK_TOTAL = QUICK.reduce((n, c) => n + c.steps.length, 0);

export const chapterById = id => CHAPTERS.find(c => c.id === id) || QUICK.find(c => c.id === id) || null;
export const chapterIndex = id => CHAPTERS.findIndex(c => c.id === id);
/** The chapter after (dir 1) or before (dir -1) this one in its tour (full or quick), or null at either end. */
export function nextChapter(id, dir = 1) {
  const L = QUICK.some(c => c.id === id) ? QUICK : CHAPTERS, i = L.findIndex(c => c.id === id);
  return i < 0 ? null : L[i + dir] || null;
}

/** The file name of a page path: '/web/' and '/' are index.html. Cloudflare serves /proof.html as /proof (a 307
 *  to the clean URL), so a last segment without an extension gets '.html' back (live "Tour this page" did nothing). */
export function pageOf(pathname = '') {
  const f = decodeURIComponent(String(pathname).split(/[?#]/)[0].split('/').pop() || '');
  return !f ? 'index.html' : f.includes('.') ? f : f + '.html';
}
/** The chapter "Tour this page" opens: index.html has two (sky map, time-lapse); notebook only when its dialog is open. */
export function chapterForPage(page, { scene = 'map', notebookOpen = false } = {}) {
  if (notebookOpen) return chapterById('notebook');
  if (page === 'index.html') return chapterById(scene === 'viewer' ? 'viewer' : 'map');
  return CHAPTERS.find(c => c.page === page) || null;
}
/** Does this chapter run on this page as it is (true), or must the tour load another page first (false)? */
export function chapterRunsHere(ch, page) { return !!ch && (ch.page === '*' || ch.page === page); }

/**
 * Which variant of a step to use here: the phone one (on phones, when shown), its own targets, then each alt.
 * shown(selector): a matching element is visible; exists(selector): one is in the page. null: skip the step.
 */
export function pickTargets(step, { phone = false, shown = () => true, exists = () => true } = {}) {
  if (!step.targets) return { targets: null, body: step.body, prefer: step.prefer };
  const cands = [phone && step.phone, step, ...[].concat(step.alt || [])].filter(Boolean);
  for (const c of cands) {
    if (c.requires && !exists(c.requires)) continue;
    if (c.targets && c.targets.some(shown)) return { targets: c.targets, title: c.title || step.title, body: c.body || step.body, prefer: c.prefer || step.prefer, lines: c.lines || step.lines };
  }
  return null;
}

/** "Archive · 2 of 4", with "Part 3 of 9 · " in front during the full tour. */
export function counterFor(ch, i, n, full) {
  if (!ch || !Number.isInteger(i) || !Number.isInteger(n) || i < 0 || i >= n) return '';
  if (ch.quick) { // one count across the quick tour's pages: "Quick tour · 4 of 6"
    let k = i; for (const c of QUICK) { if (c.id === ch.id) break; k += c.steps.length; }
    return `Quick tour · ${k + 1} of ${QUICK_TOTAL}`;
  }
  const part = full ? `Part ${chapterIndex(ch.id) + 1} of ${CHAPTERS.length} · ` : '';
  return `${part}${ch.name} · ${i + 1} of ${n}`;
}

/* ---------- progress (localStorage, always wrapped: private windows throw) ---------- */
const MAX_AGE = 7 * 864e5;
/** { mode: 'full'|'page', chapter, step, status: 'running'|'paused', nav?, t } or null. */
export function readProgress(storage, now = Date.now()) {
  if (!storage) return null;
  let p; try { p = JSON.parse(storage.getItem(PROGRESS_KEY) || 'null'); } catch { return null; }
  if (!p || typeof p !== 'object' || !chapterById(p.chapter) || !['full', 'page', 'quick'].includes(p.mode)) return null;
  if (!(now - (+p.t || 0) < MAX_AGE)) return null;
  return p;
}
export function writeProgress(storage, p, now = Date.now()) {
  if (!storage) return false;
  try { storage.setItem(PROGRESS_KEY, JSON.stringify({ ...p, t: now })); return true; } catch { return false; }
}
export function clearProgress(storage) {
  if (!storage) return false;
  try { storage.removeItem(PROGRESS_KEY); return true; } catch { return false; }
}
/** On page load: resume at once only when the tour itself just loaded this page for that chapter. */
export function shouldAutoResume(p, page) {
  return !!p && p.nav === true && p.status === 'running' && chapterRunsHere(chapterById(p.chapter), page);
}
/** Offer "Resume tour" for a tour left mid-way (any page; resuming loads the right page). */
export const canResume = p => !!p && (p.status === 'paused' || p.status === 'running');
/** Short label for the Resume key. */
export function resumeLabel(p) { const ch = p && chapterById(p.chapter); return ch ? `Resume tour: ${ch.name}` : 'Resume tour'; }

/* ---------- where the card goes ---------- */
const area = (a, b) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
export const overlapArea = area;

/**
 * Card position next to target t that never covers it when any side (or corner) leaves room.
 * Tries `prefer`, then the other sides, kept m px inside the viewport; if every side overlaps,
 * the corner with the least overlap. Returns { side, left, top, overlap } (overlap in px²).
 */
export function placeClear(t, c, vp, prefer = [], gap = 14, m = 12) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(Math.max(lo, hi), v));
  const cx = t.left + t.width / 2 - c.w / 2, cy = t.top + t.height / 2 - c.h / 2;
  const raw = {
    below: [cx, t.top + t.height + gap], above: [cx, t.top - gap - c.h],
    right: [t.left + t.width + gap, cy], left: [t.left - gap - c.w, cy],
    'corner-br': [vp.w - c.w - m, vp.h - c.h - m], 'corner-tr': [vp.w - c.w - m, m],
    'corner-bl': [m, vp.h - c.h - m], 'corner-tl': [m, m],
  };
  const sides = [...prefer, ...['below', 'above', 'right', 'left'].filter(s => !prefer.includes(s)), 'corner-br', 'corner-tr', 'corner-bl', 'corner-tl'];
  let best = null;
  for (const side of sides) {
    const [x, y] = raw[side];
    const left = Math.round(clamp(x, m, vp.w - c.w - m)), top = Math.round(clamp(y, m, vp.h - c.h - m));
    const overlap = area({ left, top, width: c.w, height: c.h }, t);
    if (overlap === 0) return { side, left, top, overlap };
    if (!best || overlap < best.overlap) best = { side, left, top, overlap };
  }
  return best;
}
