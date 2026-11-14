// Read what the user typed: a star name or sky coordinates in any common format.
// Also turns the app state into a shareable URL and back.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

export class QueryError extends Error {}

const EXAMPLES = "Try a star name like Barnard's Star, or coordinates like 269.45 +4.69 or 17 57 48.5 +04 41 36.";

// Normalise unicode symbols people paste from websites.
function clean(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/[−‒–—]/g, '-') // minus signs and dashes
    .replace(/[′’']/g, "'")
    .replace(/[″”"]/g, '"')
    .replace(/''/g, '"') // NFKC turns ″ into two primes
    .replace(/\s+/g, ' ')
    .trim();
}

function num(tok, what) {
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(tok)) throw new QueryError(`Couldn't read the ${what} "${tok}". ${EXAMPLES}`);
  return Number(tok);
}

function sexagesimal(parts, what, max) {
  const [a, b = '0', c = '0'] = parts;
  const neg = a.trim().startsWith('-');
  const d = Math.abs(num(a, what)), m = num(b, what), s = num(c, what);
  if (m >= 60 || s >= 60 || m < 0 || s < 0) throw new QueryError(`Minutes and seconds in the ${what} must be below 60.`);
  const v = d + m / 60 + s / 3600;
  if (v > max) throw new QueryError(what === 'Dec' ? 'Dec must be between -90 and +90 degrees.' : 'RA must be between 0 and 360 degrees (or 0h to 24h).');
  return neg ? -v : v;
}

// Split "RA Dec" into the two halves. Returns [raTokens, decTokens, raIsHours].
function splitCoords(s) {
  const hasHMS = /\d\s*h/i.test(s);
  const hasDMS = /\d\s*[d°]/i.test(s) || /\d\s*'/.test(s);
  // Turn unit letters into spaces but remember the structure.
  const parts = s.replace(/,/g, ' ').replace(/(\d)\s*[hdm°'":s](?=[\s\d+-]|$)/gi, '$1 ').replace(/:/g, ' ')
    .split(' ').filter(Boolean);
  if (!parts.every(p => /^[+-]?[\d.]+$/.test(p))) return null;
  const signAt = parts.findIndex((p, i) => i > 0 && /^[+-]/.test(p));
  let ra, dec;
  if (signAt > 0) { ra = parts.slice(0, signAt); dec = parts.slice(signAt); }
  else if (parts.length === 2) { ra = [parts[0]]; dec = [parts[1]]; }
  else if (parts.length === 6) { ra = parts.slice(0, 3); dec = parts.slice(3); }
  else if (parts.length === 4) { ra = parts.slice(0, 2); dec = parts.slice(2); }
  else return null;
  if (ra.length > 3 || dec.length > 3) return null;
  const raHours = hasHMS || ra.length > 1 || (s.includes(':') && ra.length > 1);
  return { ra, dec, raHours, explicit: hasHMS || hasDMS };
}

// -> { type: 'coords', ra, dec } (degrees) | { type: 'name', name }
export function parseQuery(input) {
  const s = clean(input);
  if (!s) throw new QueryError(`Type a star name or coordinates. ${EXAMPLES}`);
  if (s.length > 80) throw new QueryError('That is too long for a star name or coordinates.');
  const looksNumeric = /^[\d\s.,:+\-hmsd°'"]+$/i.test(s) && /\d/.test(s) && !/^[a-z]/i.test(s);
  if (looksNumeric) {
    const p = splitCoords(s);
    if (!p) throw new QueryError(`Couldn't read those coordinates. ${EXAMPLES}`);
    let ra = p.raHours ? sexagesimal(p.ra, 'RA', 24) * 15 : sexagesimal(p.ra, 'RA', 360);
    const dec = sexagesimal(p.dec, 'Dec', 90);
    if (ra < 0 || ra > 360) throw new QueryError('RA must be between 0 and 360 degrees (or 0h to 24h).');
    if (dec < -90 || dec > 90) throw new QueryError('Dec must be between -90 and +90 degrees.');
    if (ra === 360) ra = 0;
    return { type: 'coords', ra, dec };
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N} +\-'.*_()\[\]/]*$/u.test(s)) {
    throw new QueryError(`That doesn't look like a star name or coordinates. ${EXAMPLES}`);
  }
  return { type: 'name', name: s };
}

export function formatRA(deg) {
  let h = (((deg % 360) + 360) % 360) / 15;
  const hh = Math.floor(h); h = (h - hh) * 60;
  const mm = Math.floor(h); const ss = (h - mm) * 60;
  return `${String(hh).padStart(2, '0')}h ${String(mm).padStart(2, '0')}m ${ss.toFixed(2).padStart(5, '0')}s`;
}

export function formatDec(deg) {
  const sign = deg < 0 ? '−' : '+';
  let d = Math.abs(deg);
  const dd = Math.floor(d); d = (d - dd) * 60;
  const mm = Math.floor(d); const ss = (d - mm) * 60;
  return `${sign}${String(dd).padStart(2, '0')}° ${String(mm).padStart(2, '0')}′ ${ss.toFixed(1).padStart(4, '0')}″`;
}

// ---- URL <-> state ----------------------------------------------------------------
export const DEFAULT_SETTINGS = Object.freeze({
  fov: 10,          // arcmin: 3, 10 or 20
  band: 'all',      // 'all' or detector '1'..'6'
  stretch: 'asinh', // 'linear' | 'asinh' | 'log'
  pixels: 'smooth', // 'smooth' | 'true'
  view: 'frames',   // 'frames' | 'stacks'
  max: 120,         // frames to load: 60 | 120 | 0 (= all)
  speed: 4,         // frames per second
  mode: 'map',      // 'map' (pannable sky map) | 'film' (time-lapse)
  ch: 33,           // sky-map wavelength channel 0..101 (33 = 1.63 µm)
});

const ALLOWED = {
  fov: [3, 10, 20], band: ['all', '1', '2', '3', '4', '5', '6'], stretch: ['linear', 'asinh', 'log'],
  pixels: ['smooth', 'true'], view: ['frames', 'stacks'], max: [60, 120, 0], speed: [1, 2, 4, 8],
  mode: ['map', 'film'], ch: Array.from({ length: 102 }, (_, i) => i),
};

export function validSetting(key, value) {
  const list = ALLOWED[key];
  if (!list) return undefined;
  const v = typeof list[0] === 'number' ? Number(value) : String(value);
  return list.includes(v) ? v : undefined;
}

export function fromURL(search) {
  const p = new URLSearchParams(search);
  const settings = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (p.has(k)) { const v = validSetting(k, p.get(k)); if (v !== undefined) settings[k] = v; }
  }
  let query = null;
  if (p.has('ra') && p.has('dec')) {
    try { query = parseQuery(`${p.get('ra')} ${p.get('dec')}`); } catch { query = null; }
  } else if (p.get('q')) {
    try { query = parseQuery(p.get('q')); } catch { query = null; }
  }
  return { query, settings, frame: p.has('t') ? Math.max(0, parseInt(p.get('t'), 10) || 0) : null };
}

export function toURL(query, settings) {
  const p = new URLSearchParams();
  if (query?.type === 'name') p.set('q', query.name);
  if (query?.type === 'coords') { p.set('ra', query.ra.toFixed(5)); p.set('dec', query.dec.toFixed(5)); }
  for (const [k, v] of Object.entries(settings)) if (DEFAULT_SETTINGS[k] !== v) p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
}
