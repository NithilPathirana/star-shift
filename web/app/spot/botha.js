// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Spot's "Known asteroid" example (spot.html?field=botha). Spot's season pictures take the middle
// value of weeks of images, which removes anything that moves in minutes, so this example opens ONE
// NIGHT instead: the SPHEREx images of the 14 Dec 2025 visit (exposures 2025W50_2A_0717_1-4,
// detectors 3 and 6) with JPL Horizons' PREDICTED place of asteroid 1354 Botha at each image's time.
// Data: web/data/spot-botha.json (tools/spot_botha_bake.mjs; numbers from web/data/botha-check.json,
// tools/botha_check.mjs). Offline: one static file, no network. Pure: no DOM.
// Wording: JPL "predicts"; SPHEREx shows "a dot at the predicted place"; never detected/found/discovered.

import { measureColour, classifyColour, summarise } from './colour.js';

export const BOTHA_KEY = 'botha';
export const BOTHA_URL = 'data/spot-botha.json';

// spot-botha.json -> frames for the stage and the colour ({ n, data (NaN = blanked), detector, wavelengthUm, mjd, ... }).
export function bothaFrames(j) {
  const n = j?.grid?.n;
  return (j?.frames || []).map(f => ({
    kind: 'frame', n, data: Float32Array.from(f.data, v => (v == null ? NaN : v)), mjd: f.mjd, date: f.utc, detector: f.detector,
    wavelengthUm: f.wavelengthUm, obsid: f.obsid, exposure: f.exposure, image: f.image, predicted: f.predicted, vmag: f.vmag,
  })).sort((a, b) => a.mjd - b.mjd || a.detector - b.detector);
}
export const bothaGrid = (j) => ({ ...j.grid, c: (j.grid.n - 1) / 2 });

// The colour at JPL's predicted place in each image (the asteroid moves ~0.15 px between exposures).
export function bothaColour(frames) {
  const rows = frames.flatMap(f => measureColour([f], f.predicted.x, f.predicted.y).rows);
  const c = classifyColour(summarise(rows));
  return { ...c, seasons: ['night of 14 Dec 2025'], groups: summarise(rows) };
}

// The card shown instead of the checklist: what JPL predicts and what the images show there.
export function bothaCard(j) {
  const k = j.check, v = j.frames.find(f => Number.isFinite(f.vmag))?.vmag;
  const t0 = j.frames[0]?.utc?.slice(11, 16), t1 = j.frames[j.frames.length - 1]?.utc?.slice(11, 16);
  return {
    kind: 'known-asteroid', title: 'Known asteroid', sub: `${j.object}, as JPL predicts`,
    body: [`JPL's orbit for asteroid ${j.object} predicts it inside the dashed ring at the time of each image shown.`,
      `Season pictures take the middle value of weeks of images, which wipes out anything that moves in minutes, so this example opens one night: ${new Set(j.frames.map(f => f.exposure)).size} exposures from ${t0} to ${t1} UTC on 14 Dec 2025.`],
    evidence: [
      `A dot sits at the predicted place in ${k.seen} of ${k.measured} images (${k.rule}).`,
      `At the same sky place in ${k.controlMeasured} images from other dates (${k.controlMonths.join(', ')}), when the asteroid was elsewhere: ${k.controlSeen} dots.`,
      `Predicted brightness V ≈ ${Number.isFinite(v) ? v.toFixed(1) : '?'} (JPL Horizons, seen from SPHEREx).`,
    ],
  };
}
