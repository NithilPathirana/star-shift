// Coordinate conversions for the details panel: galactic, ecliptic, constellation,
// and (for an observer the user chooses) altitude/azimuth, rise/transit/set.
// All maths runs in the browser; nothing is sent anywhere.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm360 = (x) => ((x % 360) + 360) % 360;

function toVec(ra, dec) {
  const a = ra * D2R, d = dec * D2R;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}
function fromVec([x, y, z]) {
  return [norm360(Math.atan2(y, x) * R2D), Math.asin(Math.max(-1, Math.min(1, z))) * R2D];
}
const mul = (M, v) => [0, 1, 2].map(i => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);

// ICRS -> Galactic (Hipparcos definition, as used by Astropy).
const GAL = [
  [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
  [+0.4941094278755837, -0.4448296299600112, +0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, +0.4559837761750669],
];
export function toGalactic(ra, dec) { const [l, b] = fromVec(mul(GAL, toVec(ra, dec))); return { l, b }; }

// ICRS -> mean ecliptic of J2000 (obliquity 84381.406″, IAU 2006).
const EPS = (84381.406 / 3600) * D2R;
export function toEcliptic(ra, dec) {
  const [x, y, z] = toVec(ra, dec);
  const [lon, lat] = fromVec([x, Math.cos(EPS) * y + Math.sin(EPS) * z, -Math.sin(EPS) * y + Math.cos(EPS) * z]);
  return { lon, lat };
}

// IAU 1976 precession from J2000 to another epoch (Julian date).
export function precessFromJ2000(ra, dec, jd) {
  const T = (jd - 2451545.0) / 36525;
  const as = (s) => (s / 3600) * D2R;
  const zeta = as(2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3);
  const z = as(2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3);
  const th = as(2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3);
  const [cz, sz, cZ, sZ, ct, st] = [Math.cos(zeta), Math.sin(zeta), Math.cos(z), Math.sin(z), Math.cos(th), Math.sin(th)];
  const P = [
    [cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st],
    [sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st],
    [st * cz, -st * sz, ct],
  ];
  return fromVec(mul(P, toVec(ra, dec)));
}

const B1875_JD = 2405889.258550475;
let CON = null;
export async function loadConstellations(fetchFn = fetch, url = new URL('./data/constellations.json', import.meta.url)) {
  if (!CON) CON = await fetchFn(url).then(r => r.json());
  return CON;
}
export function setConstellationData(data) { CON = data; }

// IAU constellation (Roman 1987 method). Needs loadConstellations() first.
export function constellation(ra, dec) {
  if (!CON) return null;
  const [r1875, d1875] = precessFromJ2000(ra, dec, B1875_JD);
  const h = r1875 / 15;
  for (const [lo, hi, dlo, abbr] of CON.rows) {
    if (d1875 >= dlo && h >= lo && h < hi) return { abbr, name: CON.names[abbr] || abbr };
  }
  return null;
}

// ---- observer: local sidereal time, alt/az, rise/transit/set ------------------------
export function julianDate(date) { return date.getTime() / 86400000 + 2440587.5; }

export function gmstDeg(date) {
  const jd = julianDate(date), T = (jd - 2451545.0) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T ** 3) / 38710000);
}

// Catalogue (J2000) RA/Dec -> RA/Dec of date, which is what the local sky uses
// (precession moves stars ~0.36° between 2000 and 2026).
export function ofDate(ra, dec, date) { return precessFromJ2000(ra, dec, julianDate(date)); }

// Altitude/azimuth (azimuth from north through east), ignoring refraction.
// ra/dec are J2000 (catalogue) unless { j2000: false } says they are already of date.
export function altAz(ra, dec, lat, lon, date, { j2000 = true } = {}) {
  if (j2000) [ra, dec] = ofDate(ra, dec, date);
  const H = norm360(gmstDeg(date) + lon - ra) * D2R;
  const d = dec * D2R, p = lat * D2R;
  const sinAlt = Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(p) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(-Math.sin(H) * Math.cos(d), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(H));
  return { alt: alt * R2D, az: norm360(az * R2D) };
}

// Transit and rise/set for J2000 ra/dec. h0 = -0.5667° (standard horizon: refraction at
// the horizon, as in DESIGN.md). If the object is up now, this is the current pass (rise in
// the past, set later today); otherwise the next pass (rise, transit, set all ahead).
// Returns { transit, rise, set, transitAlt, always: 'up'|'down'|null }.
export function riseTransitSet(ra, dec, lat, lon, date, h0 = -0.5667, { j2000 = true } = {}) {
  if (j2000) [ra, dec] = ofDate(ra, dec, date);
  const SIDEREAL = 0.99726957; // solar days per sidereal day
  const DAY = 86400000;
  const Hnow = norm360(gmstDeg(date) + lon - ra); // hour angle now (deg), 0..360
  const Hs = Hnow >= 180 ? Hnow - 360 : Hnow;    // signed: <0 before transit, >0 after
  const transitAlt = 90 - Math.abs(lat - dec);
  const at = (hDeg) => new Date(date.getTime() + (hDeg / 360) * SIDEREAL * DAY); // time when H = Hnow + hDeg
  const nextTransit = at((360 - Hnow) % 360);
  const cosH = (Math.sin(h0 * D2R) - Math.sin(lat * D2R) * Math.sin(dec * D2R)) / (Math.cos(lat * D2R) * Math.cos(dec * D2R));
  if (cosH < -1) return { transit: nextTransit, rise: null, set: null, transitAlt, always: 'up' };
  if (cosH > 1) return { transit: nextTransit, rise: null, set: null, transitAlt, always: 'down' };
  const half = Math.acos(cosH) * R2D; // semi-diurnal arc (deg of hour angle)
  const transit = Math.abs(Hs) < half ? at(-Hs) : nextTransit; // up now -> this pass's transit
  const Hdays = (half / 360) * SIDEREAL;
  const rise = new Date(transit.getTime() - Hdays * DAY);
  const set = new Date(transit.getTime() + Hdays * DAY);
  return { transit, rise, set, transitAlt, always: null, up: Math.abs(Hs) < half };
}

// Sun position (low precision, ~0.01°) for "is it dark?".
export function sunRaDec(date) {
  const n = julianDate(date) - 2451545.0;
  const L = norm360(280.460 + 0.9856474 * n), g = norm360(357.528 + 0.9856003 * n) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  return { ra: norm360(Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * R2D), dec: Math.asin(Math.sin(eps) * Math.sin(lam)) * R2D };
}

// ---- "Tonight" for a fixed point on the sky: ONE definition, used by the viewer's "Where to look"
// box, the Observer rows, the details page AND the planetarium's "Can I see it tonight?" card
// (QA Sun 15 Nov: the pages disagreed). Definitions:
//   dark        = the Sun more than 12° below the horizon (nautical darkness)
//   tonight     = the coming dark period, or what is left of it if it is dark now
//   up          = above the standard horizon, -0.5667° (refraction at the horizon, as rise/set use)
//   best        = the highest point while it is dark (the transit itself when that falls in the dark)
//   well placed = best at least 20° up
//   highest     = the transit (riseTransitSet)
// Altitudes are geometric (refraction is under 0.1° above 20°). 2-minute steps.
export const DARK_SUN_ALT = -12, WELL_PLACED_ALT = 20, STD_HORIZON = -0.5667;
const sunAlt = (lat, lon, t) => { const s = sunRaDec(t); return altAz(s.ra, s.dec, lat, lon, t, { j2000: false }).alt; }; // Sun is already of date
const DAY_MS = 86400000;
// The dark window for "tonight": { start, end, inDark } or null (no dark sky in the next 24 h).
export function darkWindow(lat, lon, now, stepMin = 2) {
  const step = stepMin * 60000, n = Math.round(1440 / stepMin), isDark = t => sunAlt(lat, lon, t) < DARK_SUN_ALT;
  const inDark = isDark(now);
  let start = null;
  if (inDark) { start = now; for (let k = 1; k <= n; k++) { const t = new Date(now.getTime() - k * step); if (!isDark(t)) break; start = t; } }
  else for (let k = 1; k <= n; k++) { const t = new Date(now.getTime() + k * step); if (isDark(t)) { start = t; break; } }
  if (!start) return null;
  const from = inDark ? now : start;
  let end = new Date(from.getTime() + DAY_MS); // polar night: a day of darkness
  for (let k = 1; k <= n; k++) { const t = new Date(from.getTime() + k * step); if (!isDark(t)) { end = new Date(t.getTime() - step); break; } }
  return { start, end, inDark };
}
// Everything both pages say about tonight, as numbers. ra/dec J2000 (catalogue), Dates in and out.
export function skyTonight(ra, dec, lat, lon, now, { stepMin = 2, wellAlt = WELL_PLACED_ALT } = {}) {
  const rts = riseTransitSet(ra, dec, lat, lon, now, STD_HORIZON);
  const dark = darkWindow(lat, lon, now, stepMin);
  const out = { now, rts, dark, best: null, wellPlaced: false, hoursWell: 0, setEarlier: null };
  if (!dark || rts.always === 'down') return out;
  const from = dark.inDark ? now : dark.start, step = stepMin * 60000, alt = t => altAz(ra, dec, lat, lon, t).alt;
  let best = null, n = 0;
  for (let ms = from.getTime(); ms <= dark.end.getTime(); ms += step) {
    const t = new Date(ms), a = alt(t);
    if (a >= wellAlt) n++;
    if (a > STD_HORIZON && (!best || a > best.alt)) best = { t, alt: a };
  }
  // the transit is the true highest point: use it when it falls in tonight's dark window
  for (const tr of [rts.transit, new Date(rts.transit.getTime() - 0.99726957 * DAY_MS)]) {
    if (tr >= from && tr <= dark.end) { const a = alt(tr); if (a > STD_HORIZON && (!best || a >= best.alt)) best = { t: tr, alt: a }; }
  }
  if (best) { best.az = altAz(ra, dec, lat, lon, best.t).az; out.best = best; out.wellPlaced = best.alt >= wellAlt; out.hoursWell = n * stepMin / 60; }
  else if (dark.inDark) { // up earlier in this dark period, set since?
    let last = null;
    for (let ms = now.getTime() - step; ms >= dark.start.getTime(); ms -= step) { if (alt(new Date(ms)) > STD_HORIZON) { last = new Date(ms); break; } }
    if (last) out.setEarlier = riseTransitSet(ra, dec, lat, lon, last, STD_HORIZON).set;
  }
  return out;
}
// The shared words, so both pages say the same thing with the same numbers.
// at(Date) -> the page's time text (24-hour HH:MM, plus a day word when not today).
const DIR8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const dirWord = az => DIR8[Math.round((((az % 360) + 360) % 360) / 45) % 8];
export const whereIn = (alt, az) => alt > 85 ? 'almost straight overhead' : `in the ${dirWord(az)}`;
// kind: 'yes' (well placed) | 'low' | 'set' (set earlier tonight) | 'day' (up only in daylight/twilight) | 'polar' (no dark sky) | 'down' (never rises)
export function tonightWords(st, dec, lat, at) {
  const { rts, best, now } = st, r = Math.round;
  const kind = rts.always === 'down' ? 'down' : !st.dark ? 'polar' : st.wellPlaced ? 'yes' : best ? 'low' : st.setEarlier ? 'set' : 'day';
  const bestText = {
    down: 'it never rises above the horizon from here',
    polar: 'there is no dark sky here tonight (the Sun stays less than 12° below the horizon)',
    yes: best && `best tonight at ${at(best.t)}, ${r(best.alt)}° up ${whereIn(best.alt, best.az)}`,
    low: best && `at most ${r(best.alt)}° up while it is dark tonight, at ${at(best.t)} (under ${WELL_PLACED_ALT}°)`,
    set: st.setEarlier && `it set at ${at(st.setEarlier)} and is not up for the rest of the dark tonight`,
    day: 'it is up only in daylight or twilight tonight',
  }[kind];
  const tDir = rts.transitAlt > 85 ? ', almost straight overhead' : ` in the ${dec < lat ? 'south' : 'north'}`;
  const dayText = rts.always === 'down' ? 'It never rises above the horizon from here.'
    : rts.always === 'up' ? `It never sets from here; highest at ${at(rts.transit)}, ${r(rts.transitAlt)}° up${tDir}.`
    : `${rts.up ? 'Rose' : 'Rises'} ${at(rts.rise)}, ${rts.up && rts.transit < now ? 'was highest' : 'highest'} ${at(rts.transit)} at ${r(rts.transitAlt)}°${tDir}, sets ${at(rts.set)}.`;
  const darkText = st.dark ? `Dark sky (Sun 12° below the horizon) ${at(st.dark.inDark ? now : st.dark.start)} to ${at(st.dark.end)}.` : '';
  return { kind, bestText, dayText, darkText };
}

// Hours tonight above minAlt while it is dark, and the best time: skyTonight in short.
// Returns { hours, bestTime, bestAlt } (best only when it reaches minAlt).
export function visibleTonight(ra, dec, lat, lon, from, minAlt = WELL_PLACED_ALT) {
  const st = skyTonight(ra, dec, lat, lon, from, { wellAlt: minAlt });
  return { hours: st.hoursWell, bestTime: st.wellPlaced ? st.best.t : null, bestAlt: st.wellPlaced ? st.best.alt : null };
}
