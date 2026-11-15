// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// "Measure it yourself" (design/spec-team-extras.md item 1): the pure maths behind web/measure.html.
// No DOM here, so tests/measure.test.mjs checks it in Node. Grid convention as core/align.js:
// north up, east left; pixel (i, j) has its centre at canvas ((i + 0.5) * cell, (j + 0.5) * cell).

export const DAYS_PER_YEAR = 365.25;

// A click on a canvas that shows an n × n grid: grid pixel coordinates (0 = the centre of the first pixel).
export function clickToGrid(clientX, clientY, rect, n) {
  const cw = rect.width / n, ch = rect.height / n;
  return { x: (clientX - rect.left) / cw - 0.5, y: (clientY - rect.top) / ch - 0.5 };
}
// The other way: where a grid position sits on a canvas (CSS pixels, relative to the page).
export function gridToClient(x, y, rect, n) {
  return { clientX: rect.left + (x + 0.5) * rect.width / n, clientY: rect.top + (y + 0.5) * rect.height / n };
}

// The offset between two clicks a (first season) and b (last season), on a grid of `scale` arcsec per pixel.
// east/north in arcsec (east is to the LEFT on the grid, north is UP), pa = position angle (deg, east of north).
export function offsetOf(a, b, scale) {
  const dx = b.x - a.x, dy = b.y - a.y, px = Math.hypot(dx, dy);
  const east = -dx * scale, north = -dy * scale;
  const pa = px > 0 ? ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360 : null;
  return { dx, dy, px, arcsec: px * scale, east, north, pa };
}

export const yearsBetween = (mjdA, mjdB) => Math.abs(mjdB - mjdA) / DAYS_PER_YEAR;

// Speed in arcsec per year from the two clicks and the two stack dates (MJD).
export function speedOf(a, b, mjdA, mjdB, scale) {
  const off = offsetOf(a, b, scale), years = yearsBetween(mjdA, mjdB);
  return { ...off, years, speed: years > 0 ? off.arcsec / years : null };
}

// How much one pixel of clicking error changes the answer (arcsec per year): an honest sense of scale.
export const pixelWorth = (scale, years) => (years > 0 ? scale / years : null);

// The eight compass words for a position angle (deg, east of north).
export function compassWord(pa) {
  if (pa == null || !Number.isFinite(pa)) return null;
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(((pa % 360) + 360) % 360 / 45) % 8];
}

// Your speed against our fit (value ± err, arcsec/yr) and Gaia's catalogue value (arcsec/yr).
// sigmas = how many of the fit's uncertainties (σ) you are away from it (the honest number, always shown).
// pxOff = the same gap in pixels of clicking (one pixel = scale / years arcsec/yr). The friendly tier asks
// both: 'bullseye' within 1σ of the fit; otherwise by clicking error: 'close' ≤ ¼ px, 'good' ≤ ½ px,
// 'near' ≤ 1 px, 'off' beyond. A careful click by eye is good to about ¼ pixel (CLICK_PX), which gives
// your own uncertainty: √2 clicks × ¼ px × one pixel's worth (yourErr, arcsec/yr).
export const CLICK_PX = 0.25;
export function compareSpeed(speed, fit, gaia, { scale = 6.15, years = 1 } = {}) {
  if (!Number.isFinite(speed) || !fit || !(fit.err > 0)) return null;
  const diff = speed - fit.value, sigmas = Math.abs(diff) / fit.err;
  const worth = pixelWorth(scale, years), pxOff = worth ? Math.abs(diff) / worth : null;
  const tier = sigmas <= 1 ? 'bullseye' : pxOff == null ? (sigmas <= 3 ? 'near' : 'off')
    : pxOff <= 0.25 ? 'close' : pxOff <= 0.5 ? 'good' : pxOff <= 1 ? 'near' : 'off';
  const gaiaDiff = Number.isFinite(gaia) ? speed - gaia : null;
  const gaiaPct = Number.isFinite(gaia) && gaia ? (100 * Math.abs(speed - gaia)) / gaia : null;
  return { diff, sigmas, tier, gaiaDiff, gaiaPct, pxOff, yourErr: worth ? Math.SQRT2 * CLICK_PX * worth : null };
}

export const TIER_WORDS = {
  bullseye: { head: 'Spot on!', body: 'You match our computer fit to within its own uncertainty: nobody could tell your answer and ours apart.' },
  close: { head: 'Very close!', body: 'Your clicks were within about a quarter of a pixel of the computer\'s. That is excellent for two clicks by eye.' },
  good: { head: 'Good measuring!', body: 'Your clicks were within half a pixel of the computer\'s. Can you get closer by clicking the exact middle of the glow?' },
  near: { head: 'Close', body: 'Your clicks were within one pixel of the computer\'s. Look closely and click the very middle of the glow in both pictures.' },
  off: { head: 'Not quite yet', body: 'Your answer is far from the fit. Check that you clicked the same star in both pictures, right in its middle, then try again.' },
};

// Our fit and Gaia's value for one target from web/data/proof.json (made by tools/make_proof.mjs), in arcsec/yr:
// { fit: { value, err } | null, gaia: number | null, source }. proof.targets is a list of rows with .tests.
export function fitFromProof(proof, key) {
  const rows = Array.isArray(proof?.targets) ? proof.targets : Object.values(proof?.targets || {});
  const test = rows.find(r => r?.key === key)?.tests?.find(t => t?.type === 'motion');
  const m = test?.measured, x = test?.expected;
  return {
    fit: Number.isFinite(m?.value) && m?.err > 0 ? { value: m.value / 1000, err: m.err / 1000 } : null,
    gaia: Number.isFinite(x?.value) ? x.value / 1000 : null, source: x?.source ?? null,
  };
}

// "0.13²" or "(−1.62)²": a squared term written so a negative number reads right.
export const sq = (v, d = 2) => (v < 0 ? `(−${Math.abs(v).toFixed(d)})²` : `${v.toFixed(d)}²`);

// "2025-09-03" from an MJD.
export const mjdDay = (mjd) => new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10);

// The teacher's sheet as Markdown. r = { star, scale, first: { from, to, mjd }, last: {...}, a, b, result, cmp, fit, gaia }.
// Any missing number becomes a blank line to fill in by hand, so the same sheet works before and after measuring.
export function sheetMarkdown(r) {
  const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '______');
  const res = r.result || {}, cmp = r.cmp;
  const L = [
    `# Measure it yourself: how fast does ${r.star || "Barnard's Star"} move?`,
    '',
    'Star Shift worksheet. Data: NASA SPHEREx images from the NASA/IPAC Infrared Science Archive (IRSA).',
    '',
    'Name: ______________________   Date: ____________',
    '',
    '## 1. Blink the two pictures',
    `First season: ${r.first?.from ?? '______'} to ${r.first?.to ?? '______'}. Last season: ${r.last?.from ?? '______'} to ${r.last?.to ?? '______'}.`,
    'Each picture is many SPHEREx images stacked together. Watch the star in the middle hop when the pictures swap.',
    '',
    '## 2. Click the star\'s centre in each picture',
    `First picture: x = ${f(r.a?.x)} px, y = ${f(r.a?.y)} px. Last picture: x = ${f(r.b?.x)} px, y = ${f(r.b?.y)} px.`,
    '',
    '## 3. How far did it move?',
    `Shift = √(Δx² + Δy²) = √(${Number.isFinite(res.dx) ? sq(res.dx) : '______²'} + ${Number.isFinite(res.dy) ? sq(res.dy) : '______²'}) = ${f(res.px)} pixels.`,
    `Each pixel is ${f(r.scale)}″ (arcseconds) of sky, so the shift is ${f(res.px)} × ${f(r.scale)}″ = ${f(res.arcsec, 1)}″.`,
    '',
    '## 4. How fast?',
    `Time between the two pictures (the average dates of their images) = ${f(res.years, 3)} years.`,
    `Speed = ${f(res.arcsec, 1)}″ ÷ ${f(res.years, 3)} years = **${f(res.speed)}″ per year**.`,
    '',
    '## 5. Compare',
    `Star Shift's computer fit: ${f(r.fit?.value)} ± ${f(r.fit?.err)}″ per year. Gaia's catalogue: ${f(r.gaia)}″ per year.`,
    `My answer minus the fit = ${cmp ? (cmp.diff >= 0 ? '+' : '−') + Math.abs(cmp.diff).toFixed(2) : '______'}″ per year, which is ${cmp ? cmp.sigmas.toFixed(1) : '______'} times the fit's uncertainty (σ).`,
    `My answer is ${cmp?.gaiaPct != null ? cmp.gaiaPct.toFixed(cmp.gaiaPct < 10 ? 1 : 0) : '______'}% away from Gaia's value.`,
    '',
    `One pixel of clicking error changes the answer by ${f(pixelWorth(r.scale, res.years))}″ per year, so careful clicking matters.`,
    '',
    '## Think about it',
    '- Why do we stack many images into one picture instead of using a single image?',
    '- 1″ is about the width of a coin seen from 4 km away. How far would the star move in your lifetime?',
    '- Gaia measures positions far more precisely than SPHEREx. Why might our answer still be a little different?',
    '',
    'Made with Star Shift (team Proper Motion, NASA Space Apps 2026). Built with SI tools (Super Intelligence, NASA\'s term for AI).',
    '',
  ];
  return L.join('\n');
}
