// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// "Can I see it tonight?" answer card (DESIGN.md 26, Design review): tonight = the coming night
// at the chosen place, from sunset to sunrise (or the night we are in, if the Sun is down now).
// The object counts as up when its apparent altitude (refraction on) is above 0°. answer() is for the Moon,
// planets and asteroids (bright, seen in twilight); stars and spots use starAnswer() below (shared with the viewer).
// Pure functions: the page passes in an altitude function; tests/tonight.test.mjs checks them.
import { A } from './astro.js';
import { skyTonight, tonightWords } from '../sky.js';

const DAY = 86400000;

// The night window around `date` for an astronomy-engine Observer.
// Returns { start, end } (Dates), or { polarDay: true } / { polarNight: true, start, end }.
export function nightWindow(date, obs) {
  const t = A.MakeTime(date);
  const sun = A.Body.Sun;
  const nextSet = A.SearchRiseSet(sun, obs, -1, t, 1.2);
  const nextRise = A.SearchRiseSet(sun, obs, +1, t, 1.2);
  if (!nextSet && !nextRise) { // no sunrise or sunset within a day: midnight Sun or polar night
    const od = A.Equator(sun, t, obs, true, true), alt = A.Horizon(t, obs, od.ra, od.dec, 'normal').altitude;
    return alt > 0 ? { polarDay: true } : { polarNight: true, start: date, end: new Date(date.getTime() + DAY) };
  }
  // Sun down now: the next event is a sunrise (or there is no sunset before it)
  const downNow = nextRise && (!nextSet || nextRise.ut < nextSet.ut);
  if (downNow) {
    const prevSet = A.SearchRiseSet(sun, obs, -1, t.AddDays(-1.2), 1.2);
    const start = prevSet && prevSet.ut <= t.ut ? prevSet.date : date;
    return { start, end: nextRise.date, inNight: true };
  }
  if (!nextSet) return { polarDay: true };
  const rise = A.SearchRiseSet(sun, obs, +1, nextSet, 1.2);
  return { start: nextSet.date, end: rise ? rise.date : new Date(nextSet.date.getTime() + DAY), inNight: false };
}

// Sample altFn(Date) -> degrees from start to end; return the up intervals and the highest point.
// Rise and set edges are then bisected to ~1 s, so the card's times match the Rise/Set rows (QA tonight-4).
export function upIntervals(altFn, start, end, stepMin = 2) {
  const out = [], step = stepMin * 60000;
  let cur = null, best = null, prev = null;
  const edge = (lo, hi, upAtHi) => { // horizon crossing between two samples: first up (rise) or last up (set)
    let a = lo.getTime(), b = hi.getTime();
    while (b - a > 1000) { const m = (a + b) / 2, v = altFn(new Date(m)); if (Number.isFinite(v) && (v > 0) === upAtHi) b = m; else a = m; }
    return new Date(upAtHi ? b : a);
  };
  for (let ms = start.getTime(); ms <= end.getTime() + 1; ms += step) {
    const t = new Date(Math.min(ms, end.getTime())), a = altFn(t);
    if (!Number.isFinite(a)) continue;
    if (a > 0) {
      if (!cur) { cur = { from: prev ? edge(prev, t, true) : t, to: t }; out.push(cur); } else cur.to = t;
      if (!best || a > best.alt) best = { alt: a, at: t };
    } else { if (cur && prev) cur.to = edge(prev, t, false); cur = null; }
    prev = t;
    if (ms >= end.getTime()) break;
  }
  return { intervals: out, best };
}

// The card. fmt(Date) -> local "HH:MM". place: display name ("Colombo", "your location").
// Returns { verdict: 'yes'|'no'|'day'|'polar', head, detail }.
export function answer({ altFn, date, obs, place, fmt, stepMin = 2, _depth = 0 }) {
  const w = nightWindow(date, obs);
  if (w.polarDay) return { verdict: 'polar', head: `No night here: the Sun does not set at ${place} today`, detail: 'It stays light all day, so nothing can be seen against a dark sky.' };
  // in the middle of the night, only what is left of it counts
  const from = w.inNight && date > w.start ? date : w.start;
  const night = upIntervals(altFn, from, w.end, stepMin);
  const times = (iv) => iv.map(i => `${fmt(i.from)} to ${fmt(i.to)}`).join(' and ');
  const nightLine = `${w.inNight ? 'Night now' : 'Night'}: sunset ${fmt(w.start)}, sunrise ${fmt(w.end)}.${w.polarNight ? ' The Sun does not rise here today.' : ''}`;
  if (night.intervals.length) {
    const iv = night.intervals, allNight = iv.length === 1 && iv[0].from.getTime() <= from.getTime() && iv[0].to.getTime() >= w.end.getTime() - stepMin * 60000;
    const span = allNight ? `up ${from === date ? 'now and ' : ''}all night, until sunrise at ${fmt(w.end)}` : `up ${times(iv)}`;
    return { verdict: 'yes', head: `Yes, tonight from ${place}: ${span}, highest ${night.best.alt < 1 ? "just above the horizon" : Math.round(night.best.alt) + "°"} at ${fmt(night.best.at)}`, detail: nightLine };
  }
  if (from !== w.start) { // it was up earlier this night but has set
    const early = upIntervals(altFn, w.start, from, stepMin);
    if (early.intervals.length) {
      const next = _depth ? null : answer({ altFn, date: new Date(w.end.getTime() + 60000), obs, place, fmt, stepMin, _depth: 1 });
      return { verdict: 'set', head: `Not any more tonight: it set at ${fmt(early.intervals.at(-1).to)}`,
        detail: next?.verdict === 'yes' ? `Tomorrow night: ${next.head.replace(/^Yes, tonight from [^:]+: /, '')}.` : nightLine };
    }
  }
  // not up during the night: is it up at all in the day around it?
  const day = upIntervals(altFn, new Date(w.start.getTime() - 12 * 3600000), new Date(w.end.getTime() + 12 * 3600000), Math.max(stepMin, 5));
  if (day.intervals.length) return { verdict: 'day', head: 'Only in daylight tonight', detail: `From ${place} it is above the horizon only while the Sun is up (night: ${fmt(w.start)} to ${fmt(w.end)}).` };
  return { verdict: 'no', head: 'No: it stays below the horizon tonight from here', detail: `From ${place} it does not rise above the horizon at any time in the day around tonight.` };
}

// The card for a star or a spot on the sky: the SAME numbers and words as the viewer's
// "Where to look" box (sky.js skyTonight + tonightWords: dark = Sun below -12°, best = highest
// while dark, well placed = 20°+, highest = transit). at(Date) -> "HH:MM" (+ day word).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
export function starAnswer({ ra, dec, lat, lon, date, place, at }) {
  const st = skyTonight(ra, dec, lat, lon, date), w = tonightWords(st, dec, lat, at);
  const lead = { yes: 'Yes', low: 'Low tonight', set: 'Not any more tonight', day: 'Not in the dark tonight', polar: 'No dark sky tonight', down: 'No' }[w.kind];
  const detail = [w.darkText, w.dayText].filter(Boolean).join(' ');
  return { verdict: w.kind === 'down' ? 'no' : w.kind, head: `${lead}, from ${place}: ${w.bestText}`, detail, st, words: w };
}
