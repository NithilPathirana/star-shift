// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026

const DEFAULT_DATES = Object.freeze(['2025-08-15', '2026-03-15', '2026-08-15']);

// The page's example field (judging panel b7; AI-written code (Claude, Anthropic) for team Proper Motion,
// NASA Space Apps 2026): main-belt asteroid 1354 Botha (V 16.6) on 14 Dec 2025, centred on JPL's
// 12:00 UTC prediction. SPHEREx DR1 exposures 2025W50_2A_0717_1-4 (08:28-08:37 UTC, detectors 3 and 6)
// cover Botha's predicted place at that time (IRSA SIA point query). The second date is the patch's
// next SPHEREx season (QR3, 15 Jun 2026). tools/export_prebaked.mjs prebakes exactly this view.
export const NEO_DEFAULT_VIEW = Object.freeze({
  ra: 0.5622, dec: -1.0231, fov: 0.5,
  dates: Object.freeze(['2025-12-14', '2026-06-15']),
});
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pad(value, width = 2, decimals = 0) {
  return value.toFixed(decimals).padStart(width + (decimals ? decimals + 1 : 0), '0');
}

export function raDegreesToJpl(ra) {
  const degrees = finite(ra);
  if (degrees === null) throw new TypeError('RA must be a finite number');
  const hours = ((degrees % 360) + 360) % 360 / 15;
  const h = Math.floor(hours);
  const minutes = (hours - h) * 60;
  const m = Math.floor(minutes);
  const seconds = (minutes - m) * 60;
  return `${pad(h)}-${pad(m)}-${pad(seconds, 2, 2)}`;
}

export function decDegreesToJpl(dec) {
  const degrees = finite(dec);
  if (degrees === null || degrees < -90 || degrees > 90) {
    throw new RangeError('Dec must be between -90 and +90 degrees');
  }
  const absolute = Math.abs(degrees);
  const d = Math.floor(absolute);
  const minutes = (absolute - d) * 60;
  const m = Math.floor(minutes);
  const seconds = (minutes - m) * 60;
  return `${degrees < 0 ? 'M' : ''}${pad(d)}-${pad(m)}-${pad(seconds, 2, 2)}`;
}

export function observationDates(value, fallback = DEFAULT_DATES) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const dates = source.map(item => String(item).trim()).filter(item => {
    if (!ISO_DATE.test(item)) return false;
    const date = new Date(`${item}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === item;
  });
  return [...new Set(dates.length ? dates : fallback)];
}

/** Build one strict SB Identification request for an asteroid or comet pass. */
export function buildSbIdentParams({ ra, dec, fov, date, kind, observer = 'mpc-500' }) {
  const width = finite(fov);
  if (width === null || width <= 0 || width > 20) throw new RangeError('FOV must be greater than 0 and at most 20 degrees');
  if (!observationDates([date], []).length) throw new TypeError('Observation date must be an ISO date');
  if (!['a', 'c'].includes(kind)) throw new TypeError('Small-body kind must be a or c');

  const params = new URLSearchParams({
    'obs-time': `${date}_12:00:00`,
    'fov-ra-center': raDegreesToJpl(ra),
    'fov-dec-center': decDegreesToJpl(dec),
    'fov-ra-hwidth': String(width / 2),
    'fov-dec-hwidth': String(width / 2),
    'sb-kind': kind,
    'mag-required': 'false',
    'two-pass': 'true',
    'suppress-first-pass': 'true',
    'req-elem': 'false',
  });
  if (observer === 'geocentric-state') params.set('xobs', '0,0,0,0,0,0');
  else params.set('mpc-code', '500');
  return params;
}

function tableRows(payload) {
  const second = Array.isArray(payload?.data_second_pass) ? payload.data_second_pass : null;
  const fields = second ? payload?.fields_second : payload?.fields_first;
  const data = second || payload?.data_first_pass;
  if (!Array.isArray(fields) || !Array.isArray(data)) return [];
  return data.map(values => Object.fromEntries(fields.map((field, index) => [field, values[index]])));
}

function valueMatching(row, patterns) {
  const key = Object.keys(row).find(field => patterns.some(pattern => pattern.test(field)));
  return key ? row[key] : null;
}

function rateArcsecHour(row, axis) {
  const key = Object.keys(row).find(field => new RegExp(`^${axis} rate`, 'i').test(field));
  const value = key ? finite(row[key]) : null;
  if (value === null) return null;
  if (/arcsec\s*\/\s*h|"\s*\/\s*h/i.test(key)) return value;
  if (/deg\s*\/\s*s/i.test(key)) return value * 3600 * 3600;
  if (/deg\s*\/\s*d/i.test(key)) return value * 3600 / 24;
  return value;
}

export function parseSbIdent(payload, { date = null, kind = null } = {}) {
  return tableRows(payload).map((row, index) => {
    const raRate = rateArcsecHour(row, 'RA');
    const decRate = rateArcsecHour(row, 'Dec');
    return {
      id: `${date || 'date'}-${kind || 'body'}-${index}`,
      name: String(valueMatching(row, [/^Object name$/i, /^Name$/i]) || 'Unnamed object').trim(),
      date,
      kind,
      ra: String(valueMatching(row, [/Astrometric RA/i, /^RA$/i]) || '').trim() || null,
      dec: String(valueMatching(row, [/Astrometric Dec/i, /^Dec$/i]) || '').trim() || null,
      visualMagnitude: finite(valueMatching(row, [/Visual magnitude/i, /^V(?: mag)?$/i])),
      raRateArcsecHour: raRate,
      decRateArcsecHour: decRate,
      motionArcsecHour: raRate === null || decRate === null ? null : Math.hypot(raRate, decRate),
      raw: row,
    };
  });
}

// The Small-Body Database search string for a sb_ident name. SBDB rejects the full name with its
// parentheses ("541093 (2018 RJ4)" -> HTTP 400), so send the number, else the designation:
// "541093 (2018 RJ4)" -> "541093", "(2013 AA145)" -> "2013 AA145", "C/2020 F3 (NEOWISE)" -> "C/2020 F3",
// "29P/Schwassmann-Wachmann 1" -> "29P". AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
export function sbdbQuery(name) {
  const s = String(name || '').trim();
  let m = /^(\d+)(?:\s|$)/.exec(s);
  if (m) return m[1];
  m = /^\(([^)]+)\)$/.exec(s);
  if (m) return m[1].trim();
  m = /^(\d+[PI])(?:-[A-Z]+)?\//.exec(s);
  if (m) return m[1];
  m = /^([PCDXAI]\/\d{4} [A-Z]{1,2}\d*)/.exec(s);
  if (m) return m[1];
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim() || s;
}

export { DEFAULT_DATES };
