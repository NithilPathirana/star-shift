// Prebaked answers for NASA's five demo targets, served as static files next to the app.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// tools/export_prebaked.mjs runs the app's own loading path for the five presets and saves every
// answer it needed (IRSA image lists and cutouts, SIMBAD/Gaia cones, JPL sb_ident) under
// web/prebaked/, with web/prebaked/manifest.json mapping each request (as the app builds it) to a
// file. prebakedFetch() is a drop-in fetch: an EXACT match of the request is answered from that
// file; anything else (any other star, field, date or setting) goes to the network unchanged, so a
// non-preset query never gets stored data. A missing manifest or file also falls back to the
// network. In Node (no `location`) it is a plain fetch unless configurePrebaked() sets it up, so
// the tools (make_proof, prebake, export) always ask the relay.

// Generous: on a slow link (phone data, a cold deploy) a 4 s limit gave up on the 200 KB manifest
// and sent all five demo targets live (Dehan saw "Retrying" on a pre-baked star, Sun 15 Nov).
const MANIFEST_TIMEOUT_MS = 20000;

let custom = null;      // set by configurePrebaked (tests)
let manifestP = null;   // Promise<Map<key, file> | null>, loaded once

const urlOf = (input) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? String(input));

// The manifest key of a request: the path and query exactly as the app builds them, relative to the
// relay base (this page's origin), or the full URL for other hosts (SIMBAD's Harvard mirror).
// Both sides (the export and the browser) use this one function; only literal spaces are encoded.
// Numbers with more than 10 decimals (SIMBAD/Gaia cones send full doubles) are cut to 10 decimals
// in the KEY only (1e-10° = 0.4 µas): Node and the browser can differ in the last bit of a sine.
export function prebakedKey(url, origin) {
  let u = urlOf(url).replace(/ /g, '%20').replace(/\d+\.\d{11,}/g, (n) => Number(n).toFixed(10));
  if (origin && (u === origin || u.startsWith(origin + '/'))) u = u.slice(origin.length) || '/';
  return u;
}

function config() {
  if (custom) return custom;
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  const dir = new URL('../prebaked/', import.meta.url).href;
  return { manifestUrl: dir + 'manifest.json', fileBase: dir, origin: location.origin };
}

// For tests and tools: { manifestUrl, fileBase, origin, fetchImpl }, or null to go back to the default.
export function configurePrebaked(c) { custom = c; manifestP = null; manifestFailAt = -Infinity; }

const net = (c) => c?.fetchImpl || ((...a) => globalThis.fetch(...a));

let manifestFailAt = -Infinity; // after a failure, wait RETRY_MANIFEST_MS before asking again
const RETRY_MANIFEST_MS = 30000;
function loadManifest(c) {
  if (!manifestP && Date.now() - manifestFailAt < RETRY_MANIFEST_MS) return Promise.resolve(null);
  if (!manifestP) manifestP = (async () => {
    try {
      const res = await net(c)(c.manifestUrl, { signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
      const m = await res.json();
      return new Map(Object.entries(m?.entries || {}).map(([k, v]) => [k, v?.file]).filter(([, f]) => typeof f === 'string' && f));
    } catch {
      manifestP = null; manifestFailAt = Date.now(); // this request goes live; the manifest is tried again later
      return null;
    }
  })();
  return manifestP;
}

export async function prebakedFetch(input, init) {
  const live = () => globalThis.fetch(input, init);
  const method = String(init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
  const c = config();
  if (!c || method !== 'GET') return live();
  const map = await loadManifest(c);
  const file = map?.get(prebakedKey(input, c.origin));
  if (!file) return live();
  try {
    const res = await net(c)(c.fileBase + file, { signal: init?.signal });
    if (res.ok) return res;
    res.body?.cancel?.().catch(() => {});
  } catch (e) {
    if (init?.signal?.aborted) throw e; // the caller cancelled: do not start a live request
  }
  return live();
}
