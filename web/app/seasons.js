// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// One season source (judging panel round 4, item 1). Every season shown anywhere (the viewer's chip,
// "Season k of N", the timeline labels, the brightness-chart axis, the Proof page) comes from
// splitSeasons(). A subset of the images (one held band, the flag filter's keepers) is placed in
// those same seasons by date with seasonAt(), never split again on its own.

// SPHEREx revisits a spot about every 6 months, so a gap of `gapDays` or more starts a new season.
// Near the ecliptic poles SPHEREx sees a star all year with no long gap (R Draconis: longest gap
// 38 days), so a run longer than `maxDays` is split at its largest gap that leaves 30+ days on each
// side (ties: nearest the middle). mjds: any order. Returns [[mjd, ...], ...] in time order.
export function splitSeasons(mjds, gapDays = 60, maxDays = 183) {
  const sorted = mjds.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const runs = [];
  for (const m of sorted) {
    const r = runs[runs.length - 1];
    if (r && m - r[r.length - 1] < gapDays) r.push(m); else runs.push([m]);
  }
  const split = (r) => {
    const a = r[0], b = r[r.length - 1];
    if (r.length < 2 || b - a <= maxDays) return [r];
    const mid = (a + b) / 2; let k = -1;
    for (let j = 1; j < r.length; j++) {
      if (r[j - 1] - a < 30 || b - r[j] < 30) continue;
      const g = r[j] - r[j - 1], gk = k < 0 ? -1 : r[k] - r[k - 1];
      if (g > gk + 1e-9 || (Math.abs(g - gk) <= 1e-9 && Math.abs(r[j] - mid) < Math.abs(r[k] - mid))) k = j;
    }
    if (k < 0) k = Math.max(1, r.findIndex(m => m > mid));
    return [...split(r.slice(0, k)), ...split(r.slice(k))];
  };
  return runs.flatMap(split);
}

// Season boundaries: [{ k, startMjd, endMjd, n }].
export const seasonBounds = (mjds, gapDays, maxDays) =>
  splitSeasons(mjds, gapDays, maxDays).map((r, k) => ({ k, startMjd: r[0], endMjd: r[r.length - 1], n: r.length }));

// Which season a date belongs to: the one it falls in, else the nearest (an image outside every
// season can only happen if the bounds came from a different list). -1 when there are no seasons.
export function seasonAt(mjd, bounds) {
  if (!bounds?.length || !Number.isFinite(mjd)) return -1;
  const i = bounds.findIndex(s => mjd >= s.startMjd - 1e-6 && mjd <= s.endMjd + 1e-6);
  if (i >= 0) return i;
  let k = 0, d = Infinity;
  bounds.forEach((s, j) => { const e = Math.min(Math.abs(mjd - s.startMjd), Math.abs(mjd - s.endMjd)); if (e < d) { d = e; k = j; } });
  return k;
}

// Frames (with .mjd) grouped into the given seasons, empty seasons left out:
// [{ k, startMjd, endMjd, frames }] in time order (startMjd/endMjd = the season's, not the frames').
export function groupInto(frames, bounds) {
  const out = new Map();
  for (const f of frames) { const k = seasonAt(f.mjd, bounds); if (k < 0) continue; if (!out.has(k)) out.set(k, []); out.get(k).push(f); }
  return [...out.keys()].sort((a, b) => a - b).map(k => ({ k, startMjd: bounds[k].startMjd, endMjd: bounds[k].endMjd, frames: out.get(k).sort((a, b) => a.mjd - b.mjd) }));
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dt = (m) => new Date((m - 40587) * 864e5);
// "Feb–May 2026", "Dec 2025–Jan 2026", "May 2025": the one month name used for a season everywhere
export function seasonMonths(s) {
  const a = dt(s.startMjd), b = dt(s.endMjd), M = d => MON[d.getUTCMonth()], Y = d => d.getUTCFullYear();
  if (M(a) === M(b) && Y(a) === Y(b)) return `${M(a)} ${Y(a)}`;
  return `${M(a)}${Y(a) !== Y(b) ? ' ' + Y(a) : ''}–${M(b)} ${Y(b)}`;
}
