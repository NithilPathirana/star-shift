// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Observation Archive: pure table logic (no DOM), so it runs in Node tests and the browser.
// Rows come from the SPHEREx image list (web/core/irsa.js); images: NASA SPHEREx via IRSA
// (releases and DOIs: web/data/releases.json).

import { DEFAULT_BANDS } from '../bands.js';
import { IRSA } from '../../core/irsa.js';
import { PRESETS, findPreset } from '../presets.js';

export const PAGE_SIZES = [50, 100, 250];
export const MJD_UNIX = 40587; // MJD of 1970-01-01T00:00 UTC

// MJD -> { date: 'YYYY-MM-DD', time: 'HH:MM:SS', iso } in UTC (time scale differences of
// about a minute are ignored: this is a listing, not timing).
export function mjdToUtc(mjd) {
  if (!Number.isFinite(mjd)) return { date: '—', time: '—', iso: '' };
  const d = new Date(Math.round((mjd - MJD_UNIX) * 86400000));
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19), iso: iso.slice(0, 19) + 'Z' };
}

// "dr1" / "qr3" (or whatever release folder IRSA uses) from the image uri.
export function releaseOf(uri) {
  const m = /spherex\/([a-z0-9]+)\//i.exec(String(uri || ''));
  return m ? m[1].toLowerCase() : '—';
}

// The team colour band that overlaps a wavelength range the most (DEFAULT_BANDS).
export function bandFor(minUm, maxUm, bands = DEFAULT_BANDS) {
  if (!Number.isFinite(minUm) || !Number.isFinite(maxUm)) return null;
  let best = null, bestOv = 0;
  for (const b of bands) {
    const ov = Math.min(maxUm, b.max) - Math.max(minUm, b.min);
    if (ov > bestOv) { bestOv = ov; best = b; }
  }
  return best;
}

// Band containing one wavelength (for single measurements).
export function bandAt(um, bands = DEFAULT_BANDS) {
  if (!Number.isFinite(um)) return null;
  return bands.find(b => um >= b.min && um < b.max) ?? (um >= bands[bands.length - 1].max ? bands[bands.length - 1] : um < bands[0].min ? bands[0] : null);
}

// Observing seasons: SPHEREx revisits each spot about every 6 months, so a gap of more than
// `gapDays` between consecutive images starts a new season. Near the ecliptic poles SPHEREx looks
// all year with no long gap (R Draconis: 16 months, longest gap 38 days), so a run longer than
// `maxDays` is split at its largest gap until each part is at most `maxDays` long.
// Returns [{ i, startMjd, endMjd, n, label }].
export function seasonsOf(mjds, gapDays = 60, maxDays = 183) {
  const sorted = mjds.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const runs = [];
  for (const m of sorted) {
    const r = runs[runs.length - 1];
    if (r && m - r[r.length - 1] < gapDays) r.push(m); else runs.push([m]);
  }
  const split = (r) => {
    if (r.length < 2 || r[r.length - 1] - r[0] <= maxDays) return [r];
    // largest gap that leaves at least 30 days on each side (ties: the one nearest the middle)
    const a = r[0], b = r[r.length - 1], mid = (a + b) / 2;
    let k = -1;
    for (let j = 1; j < r.length; j++) {
      if (r[j - 1] - a < 30 || b - r[j] < 30) continue;
      const g = r[j] - r[j - 1], gk = k < 0 ? -1 : r[k] - r[k - 1];
      if (g > gk + 1e-9 || (Math.abs(g - gk) <= 1e-9 && Math.abs(r[j] - mid) < Math.abs(r[k] - mid))) k = j;
    }
    if (k < 0) k = Math.max(1, r.findIndex(m => m > mid));
    return [...split(r.slice(0, k)), ...split(r.slice(k))];
  };
  return runs.flatMap(split).map((r, i) => ({ startMjd: r[0], endMjd: r[r.length - 1], n: r.length, i, label: seasonLabel(r[0], r[r.length - 1]) }));
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function seasonLabel(a, b) {
  const da = new Date((a - MJD_UNIX) * 86400000), db = new Date((b - MJD_UNIX) * 86400000);
  const ma = `${MON[da.getUTCMonth()]} ${da.getUTCFullYear()}`, mb = `${MON[db.getUTCMonth()]} ${db.getUTCFullYear()}`;
  return ma === mb ? ma : `${ma} – ${mb}`;
}

export function seasonIndex(mjd, seasons) {
  const s = seasons.find(x => mjd >= x.startMjd - 1e-6 && mjd <= x.endMjd + 1e-6);
  return s ? s.i : -1;
}

// Image list -> table rows (time order, # from 1).
export function toRows(images) {
  const sorted = images.slice().sort((a, b) => a.mjdStart - b.mjdStart);
  const seasons = seasonsOf(sorted.map(im => im.mjdStart));
  return sorted.map((im, k) => {
    const band = bandFor(im.bandMinUm, im.bandMaxUm);
    const t = mjdToUtc(im.mjdStart);
    return {
      n: k + 1, uri: im.uri, mjd: im.mjdStart, mjdEnd: im.mjdEnd, date: t.date, time: t.time, iso: t.iso,
      season: seasonIndex(im.mjdStart, seasons), detector: im.detector,
      wlMin: im.bandMinUm, wlMax: im.bandMaxUm, band: band?.name ?? null, bandId: band?.id ?? null, bandColor: band?.color ?? null,
      obsid: im.obsid ?? '', release: releaseOf(im.uri), irsaUrl: `${IRSA}/${im.uri}`,
      flags: null, status: 'waiting', // flags: summary from summarizeFlags once the cutout is loaded
    };
  });
}

// ---- flags ------------------------------------------------------------------------------
// Kinds the team asked for, mapped to the real FLAGS bit names in SPHEREx headers.
// SOURCE and FULLSAMPLE only describe the pixel (a star is there / sampled fully), so they
// are not counted as problems.
export const FLAG_KINDS = [
  { id: 'cosmic', label: 'Cosmic rays', names: ['TRANSIENT', 'SNOWBALL', 'HALO'] },
  { id: 'overflow', label: 'Overflow', names: ['OVERFLOW'] },
  { id: 'scatter', label: 'Scattered light', names: [], prefix: 'GHOST' },
  { id: 'other', label: 'Other' },
];
export const INFO_FLAGS = ['SOURCE', 'FULLSAMPLE'];

export function kindOfName(name) {
  if (INFO_FLAGS.includes(name)) return null;
  for (const k of FLAG_KINDS) {
    if (k.names?.includes(name)) return k.id;
    if (k.prefix && name.startsWith(k.prefix)) return k.id;
  }
  return 'other';
}

// Bit masks per kind from a cutout's flagNames ({ bit: { name } }).
export function kindMasksOf(flagNames) {
  const m = { cosmic: 0, overflow: 0, scatter: 0, other: 0 };
  for (const [bit, d] of Object.entries(flagNames || {})) {
    const k = kindOfName(d.name);
    if (k) m[k] |= Number(bit);
  }
  return m;
}

// Count flagged pixels by kind (a pixel can count in several kinds) and by bit name.
// flags: array-like of flag words; idx: optional list of pixel indices to look at.
export function summarizeFlags(flags, flagNames, idx = null) {
  const masks = kindMasksOf(flagNames);
  const problem = masks.cosmic | masks.overflow | masks.scatter | masks.other;
  const bits = Object.entries(flagNames || {}).map(([b, d]) => [Number(b), d.name]);
  const out = { total: 0, flagged: 0, cosmic: 0, overflow: 0, scatter: 0, other: 0, byName: {} };
  const n = idx ? idx.length : flags.length;
  for (let k = 0; k < n; k++) {
    const f = flags[idx ? idx[k] : k];
    out.total++;
    if (!f) continue;
    if (f & problem) out.flagged++;
    for (const id of ['cosmic', 'overflow', 'scatter', 'other']) if (f & masks[id]) out[id]++;
    for (const [b, name] of bits) if (f & b) out.byName[name] = (out.byName[name] || 0) + 1;
  }
  return out;
}

export function flagText(s) {
  if (!s) return '';
  if (!s.flagged) return `0 of ${s.total}`;
  const parts = FLAG_KINDS.filter(k => s[k.id]).map(k => `${k.label.toLowerCase()} ${s[k.id]}`);
  return `${s.flagged} of ${s.total} (${parts.join(', ')})`;
}

// ---- sort / filter / page -----------------------------------------------------------------
export const SORT_KEYS = {
  n: r => r.n, date: r => r.mjd, time: r => r.mjd, mjd: r => r.mjd, season: r => r.season, detector: r => r.detector,
  wl: r => r.wlStar ?? r.wlMin, band: r => r.wlStar ?? r.wlMin, obsid: r => r.obsid, release: r => r.release,
  flags: r => (r.flags ? r.flags.flagged : null), status: r => r.status,
};

// Stable sort; rows whose key is null (e.g. flags not checked yet) always go last.
export function sortRows(rows, key = 'n', dir = 'asc') {
  const get = SORT_KEYS[key] || SORT_KEYS.n, s = dir === 'desc' ? -1 : 1;
  return rows.map((r, i) => [r, get(r), i]).sort((a, b) => {
    const x = a[1], y = b[1];
    if (x == null && y == null) return a[2] - b[2];
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y;
    return c ? c * s : a[2] - b[2];
  }).map(e => e[0]);
}

// filter: { season (index or 'all'), band (id or 'all'), detector ('all' | 1..6), release ('all'|'dr1'|..),
//           hasFlags ('all' | 'yes' | 'no' | 'unchecked'), text }
export function filterRows(rows, f = {}) {
  const text = String(f.text ?? '').trim().toLowerCase();
  return rows.filter(r =>
    (f.season == null || f.season === 'all' || r.season === Number(f.season)) &&
    (f.band == null || f.band === 'all' || r.bandId === f.band) &&
    (f.detector == null || f.detector === 'all' || r.detector === Number(f.detector)) &&
    (f.release == null || f.release === 'all' || r.release === f.release) &&
    (f.hasFlags == null || f.hasFlags === 'all' ||
      (f.hasFlags === 'yes' && r.flags && r.flags.flagged > 0) ||
      (f.hasFlags === 'no' && r.flags && r.flags.flagged === 0) ||
      (f.hasFlags === 'unchecked' && !r.flags)) &&
    (!text || `${r.obsid} ${r.date} ${r.time} ${r.uri} ${r.band ?? ''}`.toLowerCase().includes(text)));
}

export function paginate(rows, page, size) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(0, page | 0), pages - 1);
  return { rows: rows.slice(p * size, p * size + size), page: p, pages, total: rows.length, from: rows.length ? p * size + 1 : 0, to: Math.min(rows.length, p * size + size) };
}

// ---- CSV + links ----------------------------------------------------------------------------
export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCSV(header, lines) {
  return [header, ...lines].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function rowsToCSV(rows, seasons = []) {
  const header = ['n', 'date_utc', 'time_utc', 'mjd_start', 'mjd_end', 'season', 'detector', 'wavelength_min_um', 'wavelength_max_um', 'band',
    'wavelength_at_star_um', 'obs_id', 'release', 'flag_patch_pixels', 'flagged_pixels', 'cosmic_ray_pixels', 'overflow_pixels', 'scattered_light_pixels', 'other_flag_pixels', 'irsa_fits_url'];
  const lines = rows.map(r => [r.n, r.date, r.time, r.mjd?.toFixed(6), r.mjdEnd?.toFixed(6), seasons[r.season]?.label ?? '', r.detector,
    r.wlMin?.toFixed(4), r.wlMax?.toFixed(4), r.band ?? '', r.wlStar?.toFixed(4) ?? '', r.obsid, r.release,
    r.flags?.total ?? '', r.flags?.flagged ?? '', r.flags?.cosmic ?? '', r.flags?.overflow ?? '', r.flags?.scatter ?? '', r.flags?.other ?? '', r.irsaUrl]);
  return toCSV(header, lines);
}

// Link that opens the patch in the main viewer. `mjd` + `det` name the image the viewer stops on
// (one exposure puts the star on two detectors at once, e.g. D1 and D4, so det says which).
const imageParams = (p, mjd, det) => {
  if (Number.isFinite(mjd)) p.set('mjd', mjd.toFixed(5));
  if (Number.isFinite(mjd) && Number.isInteger(det) && det > 0) p.set('det', String(det));
};
export function viewerUrl(ra, dec, mjd, det) {
  const p = new URLSearchParams({ ra: (+ra).toFixed(5), dec: (+dec).toFixed(5), scene: 'viewer' });
  imageParams(p, mjd, det);
  return `index.html?${p}`;
}

// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Play link for a resolved target: one of the five built-in targets goes by its name (?q=<label>),
// so the viewer uses the name, the ring and the pre-saved data; any other patch keeps ra/dec.
export function targetViewerUrl(t, mjd, det) {
  const preset = t?.presetKey ? PRESETS.find(p => p.key === t.presetKey) : (t?.name ? findPreset(t.name) : null);
  if (!preset) return viewerUrl(t.ra, t.dec, mjd, det);
  const p = new URLSearchParams({ q: preset.label, scene: 'viewer' });
  imageParams(p, mjd, det);
  return `index.html?${p}`;
}
