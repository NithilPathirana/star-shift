// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
// Add this in upstreamFor(), after `const p = url.pathname;`:
// const jpl = jplRoute(url); if (jpl) return jpl;

const HOUR = 60 * 60;

const ENDPOINTS = Object.freeze({
  '/jpl/cad': {
    target: 'https://ssd-api.jpl.nasa.gov/cad.api',
    ttl: HOUR,
    params: [
      'date-min', 'date-max', 'dist-min', 'dist-max', 'min-dist-min',
      'min-dist-max', 'h-min', 'h-max', 'v-inf-min', 'v-inf-max',
      'v-rel-min', 'v-rel-max', 'class', 'pha', 'nea', 'comet',
      'nea-comet', 'neo', 'kind', 'spk', 'des', 'body', 'sort', 'limit',
      'limit-from', 'total-only', 'diameter', 'fullname',
    ],
  },
  '/jpl/sentry': {
    target: 'https://ssd-api.jpl.nasa.gov/sentry.api',
    ttl: 6 * HOUR,
    params: ['spk', 'des', 'h-max', 'ps-min', 'ip-min', 'days', 'all', 'removed'],
  },
  '/jpl/sbdb': {
    target: 'https://ssd-api.jpl.nasa.gov/sbdb.api',
    ttl: HOUR,
    params: [
      'sstr', 'spk', 'des', 'neo', 'alt-des', 'alt-spk', 'full-prec',
      'soln-epoch', 'cd-epoch', 'cd-tp', 'cov', 'nv-fmt', 'anc-data',
      'no-orbit', 'alt-orbits', 'orbit-defs', 'sat', 'phys-par',
      'ca-data', 'ca-body', 'ca-time', 'ca-tunc', 'ca-unc', 'radar-obs',
      'r-name', 'r-observer', 'r-notes', 'vi-data', 'discovery',
      'raw-citation',
    ],
  },
  '/jpl/sb_ident': {
    target: 'https://ssd-api.jpl.nasa.gov/sb_ident.api',
    ttl: HOUR,
    params: [
      'mpc-code', 'lat', 'lon', 'alt', 'dxy', 'dz', 'xobs', 'xobs-hel',
      'obs-time', 'vmag-lim', 'fov-ra-lim', 'fov-dec-lim',
      'fov-ra-center', 'fov-dec-center', 'fov-ra-hwidth', 'fov-dec-hwidth',
      'two-pass', 'mag-required', 'suppress-first-pass', 'req-elem',
      'sb-group', 'sb-kind',
    ],
  },
  '/jpl/horizons': {
    target: 'https://ssd.jpl.nasa.gov/api/horizons.api',
    ttl: HOUR,
    params: [
      'format', 'COMMAND', 'OBJ_DATA', 'MAKE_EPHEM', 'EPHEM_TYPE', 'CENTER',
      'REF_PLANE', 'COORD_TYPE', 'SITE_COORD', 'START_TIME', 'STOP_TIME',
      'STEP_SIZE', 'TIME_DIGITS', 'TIME_TYPE', 'TIME_ZONE', 'TLIST',
      'TLIST_TYPE', 'QUANTITIES', 'REF_SYSTEM', 'OUT_UNITS', 'VEC_TABLE',
      'VEC_CORR', 'CAL_FORMAT', 'CAL_TYPE', 'ANG_FORMAT', 'APPARENT',
      'RANGE_UNITS', 'SUPPRESS_RANGE_RATE', 'ELEV_CUT', 'SKIP_DAYLT',
      'SOLAR_ELONG', 'AIRMASS', 'CSV_FORMAT', 'VEC_LABELS', 'VEC_DELTA_T',
      'ELM_LABELS', 'TP_TYPE', 'R_T_S_ONLY',
    ],
    long: ['TLIST'],
  },
});

for (const endpoint of Object.values(ENDPOINTS)) {
  endpoint.params = new Set(endpoint.params);
  endpoint.long = new Set(endpoint.long || []);
}

/**
 * Return a fixed JPL upstream for an approved local route, or null.
 * Query names are endpoint-specific; values and the whole query are capped so
 * the relay cannot be repurposed as an unbounded pass-through.
 */
export function jplRoute(input) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(input, 'http://relay.invalid');
  } catch {
    return null;
  }

  const endpoint = ENDPOINTS[url.pathname];
  if (!endpoint || url.search.length > 8192) return null;

  for (const [name, value] of url.searchParams) {
    const max = endpoint.long.has(name) ? 4096 : 512;
    if (!endpoint.params.has(name) || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
      return null;
    }
  }

  return { target: endpoint.target + url.search, kind: 'jpl', ttl: endpoint.ttl };
}

