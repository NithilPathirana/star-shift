// Coordinate details panel: everything we can say about one point on the sky.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

import { formatRA, formatDec } from './query.js';
import { toGalactic, toEcliptic, constellation, loadConstellations, altAz, riseTransitSet, visibleTonight } from './sky.js';
import { listImages } from '../core/irsa.js';
import { separationArcsec } from '../core/motion.js';
import { simbadCone, otypeName } from './skymap.js';
import { BANDS } from './data.js';

const fmtTime = (d) => d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDay = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;

// Observer location: only in memory for this page (never stored, never sent).
let observer = null; // { lat, lon, label }
export function setObserver(o) { observer = o; }
export function getObserver() { return observer; }

export function parseLatLon(text) {
  const m = String(text).trim().match(/^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]), lon = Number(m[3]);
  if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function observerHTML(ra, dec, now = new Date()) {
  if (!observer) return '';
  const { lat, lon } = observer;
  const aa = altAz(ra, dec, lat, lon, now);
  const rts = riseTransitSet(ra, dec, lat, lon, now);
  const vis = visibleTonight(ra, dec, lat, lon, now);
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const compass = dirs[Math.round(aa.az / 45) % 8];
  let up = rts.always === 'up' ? 'Never sets from here' : rts.always === 'down' ? 'Never rises from here' : `Rises ${fmtTime(rts.rise)} · highest ${fmtTime(rts.transit)} (${rts.transitAlt.toFixed(0)}°) · sets ${fmtTime(rts.set)}`;
  const tonight = vis.hours > 0 ? `Yes: about ${vis.hours.toFixed(1)} h above 20° in the dark, best around ${fmtTime(vis.bestTime)} (${vis.bestAlt.toFixed(0)}°)` : 'Not well placed in the next 24 h (below 20° while it is dark)';
  return `<dl class="facts">
    ${row('Now', `${aa.alt >= 0 ? 'Above' : 'Below'} the horizon: altitude ${aa.alt.toFixed(1)}°, azimuth ${aa.az.toFixed(1)}° (${compass})`)}
    ${row('Today', up)}
    ${row('Tonight', tonight)}
  </dl><p class="muted small">From ${esc(observer.label)} (${lat.toFixed(2)}°, ${lon.toFixed(2)}°), times in your time zone. Your location stays in this browser tab: it is never saved or sent anywhere.</p>`;
}

// Fast part: pure maths. Slow parts (IRSA coverage, SIMBAD neighbours) fill in later.
export async function staticDetails(ra, dec, fovDeg) {
  await loadConstellations().catch(() => {});
  const g = toGalactic(ra, dec), e = toEcliptic(ra, dec), c = constellation(ra, dec);
  return `<dl class="facts">
    ${row('RA, Dec', `<span class="mono">${formatRA(ra)}&nbsp; ${formatDec(dec)}</span>`)}
    ${row('Decimal', `<span class="mono">${ra.toFixed(5)}°, ${dec >= 0 ? '+' : ''}${dec.toFixed(5)}°</span>`)}
    ${row('Galactic', `<span class="mono">l ${g.l.toFixed(4)}°, b ${g.b >= 0 ? '+' : ''}${g.b.toFixed(4)}°</span>`)}
    ${row('Ecliptic', `<span class="mono">λ ${e.lon.toFixed(4)}°, β ${e.lat >= 0 ? '+' : ''}${e.lat.toFixed(4)}°</span>`)}
    ${row('Constellation', c ? esc(c.name) : '—')}
    ${fovDeg ? row('Field shown', fovDeg >= 1 ? `${fovDeg.toFixed(2)}°` : `${(fovDeg * 60).toFixed(1)}′`) : ''}
  </dl>`;
}

export async function coverageHTML(ra, dec, { base, signal } = {}) {
  const imgs = await listImages(ra, dec, { base, signal });
  if (!imgs.length) return '<p>No SPHEREx images cover this point in the released data yet.</p>';
  const dets = [...new Set(imgs.map(i => i.detector))].sort();
  const first = imgs[0].mjdStart, last = imgs[imgs.length - 1].mjdStart;
  const d = (mjd) => new Date(Date.UTC(1858, 10, 17) + mjd * 86400000);
  return `<dl class="facts">
    ${row('Images', `${imgs.length}`)}
    ${row('Dates', `${fmtDay(d(first))} – ${fmtDay(d(last))}`)}
    ${row('Detectors', dets.map(x => `${x} <span class="muted">(${BANDS[x]})</span>`).join('<br>'))}
  </dl>`;
}

export async function neighboursHTML(ra, dec, { radiusArcmin = 3, signal } = {}) {
  const rows = await simbadCone(ra, dec, radiusArcmin / 60, { limit: 40, signal });
  if (!rows.length) return `<p class="muted">No catalogued objects within ${radiusArcmin}′ (SIMBAD).</p>`;
  const list = rows.map(o => ({ ...o, sep: separationArcsec(ra, dec, o.ra, o.dec) })).sort((a, b) => a.sep - b.sep).slice(0, 8);
  return `<ul class="neighbours">${list.map(o => `<li><span>${esc(o.name)}</span> <span class="muted">${esc(otypeName(o.otype))} · ${o.sep < 60 ? o.sep.toFixed(0) + '″' : (o.sep / 60).toFixed(1) + '′'}</span></li>`).join('')}</ul>`;
}
