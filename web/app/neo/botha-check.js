// The example field's measured check: is the JPL-predicted asteroid 1354 Botha visible in SPHEREx's
// 14 Dec 2025 images? tools/botha_check.mjs measures it and writes web/data/botha-check.json; this
// turns those numbers into the page's words (never typed numbers). Only a 'seen' verdict changes the
// wording; anything else (or no file) keeps "a prediction from its orbit".
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

const fix1 = (v) => Number(v).toFixed(1);
const monthName = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// { simple, expert, lead, rowSimple, rowExpert } or null when the check does not support the wording.
export function bothaCheckText(check) {
  const s = check?.summary, c = check?.control;
  if (check?.verdict !== 'seen' || !s || !c || !Array.isArray(check.exposures) || !Array.isArray(c.images)) return null;
  if (!(s.measured >= 7 && s.seen >= s.measured - 1 && c.measured > 0 && c.seen === 0)) return null;
  const seen = check.exposures.filter(r => r.seen);
  const offs = seen.map(r => r.peakOffsetPx).filter(Number.isFinite);
  const ctlSnr = c.images.filter(r => Number.isFinite(r.snr)).map(r => r.snr);
  const dets = (check.visit?.detectors || []).map(d => `D${d}`).join(' and ');
  const months = (c.months || []).map(m => `${monthName(m)}${m === String(check.date).slice(0, 7) ? ' (other days)' : ''}`).join(', ');
  return {
    simple: `The SPHEREx images taken then show a dot at that exact place in ${s.seen} of ${s.measured} pictures, and nothing there in ${c.measured} pictures of the same sky from other dates, so it is not a star that is always there.`,
    expert: `Our check (tools/botha_check.mjs): at JPL’s place seen from SPHEREx at each image’s mid-time, a dot in ${s.seen} of ${s.measured} images${dets ? ` (${dets})` : ''}, S/N ${fix1(s.snrMin)}–${fix1(s.snrMax)} in a ${check.method?.apertureRadiusPx ?? 1.5} px aperture, peak ${fix1(Math.min(...offs))}–${fix1(Math.max(...offs))} px from the prediction; the same sky in ${c.measured} images from ${months}: none${ctlSnr.length ? ` (S/N at most ${fix1(Math.max(...ctlSnr))})` : ''}.`,
    lead: `and the SPHEREx images show a dot there (${s.seen} of ${s.measured})`,
    rowSimple: `SPHEREx images show a dot here (${s.seen} of ${s.measured})`,
    rowExpert: `Dot at this place in ${s.seen} of ${s.measured} SPHEREx images, S/N ${fix1(s.snrMin)}–${fix1(s.snrMax)}`,
  };
}

// The check applies to one table row: this asteroid, on this date, timed to an exposure of the measured visit.
export function checkAppliesTo(check, item) {
  const number = String(check?.object || '').split(' ')[0];
  return !!(number && item && String(item.name || '').startsWith(`${number} `) && item.date === check.date
    && item.time?.covered && (check.visit?.exposures || []).includes(item.time.exposure));
}

export async function loadBothaCheck(signal) {
  try {
    const res = await fetch(new URL('../../data/botha-check.json', import.meta.url), { signal });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
