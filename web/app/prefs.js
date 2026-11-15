// Clarity settings for the Viewer: defaults and reading the saved choices (pure, testable).
// Work order 7: interface sounds are OFF for everyone until they turn the "Sounds" switch on.
// The old key `sound` (on by default, saved as a side effect of any other change) is ignored,
// so every visitor starts silent once; only an explicit `sounds: true` turns sound on.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

export const CLARITY_KEY = 'tgi-clarity-v1';

/** Defaults; os = { reduceMotion, reduceTransparency, moreContrast } from the browser. */
export function clarityDefaults(os = {}) {
  return {
    motion: !!os.reduceMotion, glass: !!os.reduceTransparency, contrast: !!os.moreContrast,
    text: false, sounds: false, hatch: true, ring: true, str: 'auto', ramp: 'copper',
  };
}

/** Saved JSON (or null) + OS hints -> settings object. Never throws. */
export function readClarity(raw, os = {}) {
  let saved = null; try { saved = JSON.parse(raw || 'null'); } catch { saved = null; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const out = { ...clarityDefaults(os), ...saved };
  delete out.sound; // legacy default-on key: not a real choice
  out.sounds = saved.sounds === true;
  return out;
}
