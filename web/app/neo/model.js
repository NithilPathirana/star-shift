// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026

export const AU_KM = 149_597_870.7;
export const LD_KM = 384_400;
export const TDB_MINUS_UTC_SECONDS_2026 = 69.184;

const MONTH = Object.freeze({
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
});

export function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function rowsFromFields(payload) {
  if (!Array.isArray(payload?.fields) || !Array.isArray(payload?.data)) return [];
  return payload.data.map(values => Object.fromEntries(payload.fields.map((field, index) => [field, values[index]])));
}

export function julianDateToUtc(jd) {
  const value = finite(jd);
  if (value === null) return null;
  return new Date((value - 2_440_587.5) * 86_400_000 - TDB_MINUS_UTC_SECONDS_2026 * 1000);
}

export function parseJplCalendarDate(value) {
  const match = /^(\d{4})-([A-Z][a-z]{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(String(value || '').trim());
  if (!match || MONTH[match[2]] === undefined) return null;
  return new Date(Date.UTC(Number(match[1]), MONTH[match[2]], Number(match[3]), Number(match[4] || 0), Number(match[5] || 0)));
}

export function estimateDiameterKm(h, albedoMin = 0.05, albedoMax = 0.25) {
  const magnitude = finite(h);
  if (magnitude === null || !(albedoMin > 0) || !(albedoMax >= albedoMin)) return null;
  const factor = 1329 * 10 ** (-magnitude / 5);
  return {
    min: factor / Math.sqrt(albedoMax),
    max: factor / Math.sqrt(albedoMin),
  };
}

export function parseCad(payload, period = 'upcoming') {
  return rowsFromFields(payload).map((row, index) => {
    const distanceAu = finite(row.dist);
    const diameter = finite(row.diameter);
    const estimate = diameter === null ? estimateDiameterKm(row.h) : { min: diameter, max: diameter };
    return {
      id: `${period}-${row.des || index}-${row.jd || row.cd || index}`,
      period,
      designation: String(row.des || '').trim(),
      name: String(row.fullname || row.des || 'Unnamed object').trim(),
      date: julianDateToUtc(row.jd) || parseJplCalendarDate(row.cd),
      dateSource: row.jd ? 'Converted from JPL TDB epoch to UTC' : 'JPL calendar time',
      distanceAu,
      distanceKm: distanceAu === null ? null : distanceAu * AU_KM,
      distanceLd: distanceAu === null ? null : distanceAu * AU_KM / LD_KM,
      speedKms: finite(row.v_rel),
      h: finite(row.h),
      diameterMinKm: estimate?.min ?? null,
      diameterMaxKm: estimate?.max ?? null,
      diameterSource: diameter === null ? 'Estimated from H for albedo 0.05–0.25' : 'JPL measured/compiled diameter',
      raw: row,
    };
  }).filter(row => row.date instanceof Date && !Number.isNaN(row.date.valueOf()));
}

export function torinoLabel(value) {
  const rating = Math.max(0, Math.min(10, Math.trunc(finite(value) ?? 0)));
  if (rating === 0) return 'No hazard';
  if (rating === 1) return 'Normal';
  if (rating <= 4) return 'Meriting attention by astronomers';
  if (rating <= 6) return 'Threatening event';
  if (rating === 7) return 'Very threatening event';
  return 'Certain collision';
}

export function palermoMeaning(value) {
  const rating = finite(value);
  if (rating === null) return 'Not reported';
  if (rating < -2) return 'No concern';
  if (rating < 0) return 'Below the background risk';
  return 'At or above the background risk';
}

export function parseSentry(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((row, index) => ({
    id: String(row.id || row.des || index),
    designation: String(row.des || '').trim(),
    name: String(row.fullname || row.des || 'Unnamed object').trim(),
    impactProbability: finite(row.ip),
    palermoCumulative: finite(row.ps_cum),
    palermoMax: finite(row.ps_max),
    torino: finite(row.ts_max),
    diameterKm: finite(row.diameter),
    impactYears: row.range ? String(row.range) : null,
    potentialImpacts: finite(row.n_imp),
  })).sort((a, b) => (b.palermoCumulative ?? -Infinity) - (a.palermoCumulative ?? -Infinity));
}

export function summarizeThreat(approaches, risks, now = new Date()) {
  const upcoming = approaches
    .filter(item => item.date >= now)
    .sort((a, b) => a.date - b.date);
  const closest = upcoming
    .filter(item => item.distanceKm !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0] || null;
  const maxTorino = risks.reduce((max, item) => Math.max(max, item.torino ?? 0), 0);
  return {
    maxTorino,
    closest,
    withinOneLd: upcoming.filter(item => item.distanceLd !== null && item.distanceLd <= 1).length,
    upcomingCount: upcoming.length,
  };
}

function keyed(items, key = 'name') {
  return Object.fromEntries((Array.isArray(items) ? items : []).map(item => [item[key], item]));
}

export function parseSbdb(payload, now = new Date()) {
  const elements = keyed(payload?.orbit?.elements);
  const physical = keyed(payload?.phys_par);
  const closeApproaches = (Array.isArray(payload?.ca_data) ? payload.ca_data : [])
    .map(item => ({
      body: item.body || null,
      date: parseJplCalendarDate(item.cd),
      distanceAu: finite(item.dist),
      speedKms: finite(item.v_rel),
      uncertaintyMinutes: finite(item.sigma_t),
    }))
    .filter(item => item.date)
    .sort((a, b) => a.date - b.date);

  return {
    designation: payload?.object?.des || null,
    name: payload?.object?.shortname || payload?.object?.fullname || payload?.object?.des || 'Unknown object',
    fullName: payload?.object?.fullname || null,
    orbitClass: payload?.object?.orbit_class?.name || null,
    orbitClassCode: payload?.object?.orbit_class?.code || null,
    pha: payload?.object?.pha ?? null,
    neo: payload?.object?.neo ?? null,
    epochJd: finite(payload?.orbit?.epoch),
    moidAu: finite(payload?.orbit?.moid),
    elements: Object.fromEntries(Object.entries(elements).map(([name, item]) => [name, finite(item.value)])),
    physical: {
      h: finite(physical.H?.value),
      diameterKm: finite(physical.diameter?.value),
      albedo: finite(physical.albedo?.value),
      rotationHours: finite(physical.rot_per?.value),
    },
    closeApproaches,
    nextCloseApproaches: closeApproaches.filter(item => item.date >= now).slice(0, 5),
  };
}
