// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import { finite, parseJplCalendarDate } from '../neo/model.js';
import {
  AU_KM, J2000_JD, JULIAN_YEAR_DAYS, distanceBetween, heliocentricPosition,
  meanOrbitalSpeedKms, perihelionAphelion, periodYearsFromA, visVivaKms,
} from './kepler.js';

const PLANET_ELEMENTS = Object.freeze({
  Mercury: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
  Venus: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
  Earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
  Mars: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
  Jupiter: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
  Saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
  Uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
  Neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
});

const PHYSICAL = Object.freeze({
  Mercury: [4_879.4, 0.142, 1_407.6], Venus: [12_103.6, 0.689, -5_832.5],
  Earth: [12_742, 0.434, 23.934], Mars: [6_779, 0.170, 24.623],
  Jupiter: [139_820, 0.538, 9.925], Saturn: [116_460, 0.499, 10.656],
  Uranus: [50_724, 0.488, -17.24], Neptune: [49_244, 0.442, 16.11],
});

function planetRecord(name) {
  const [a, e, i, longitude, longitudePerihelion, node] = PLANET_ELEMENTS[name];
  const periodYears = periodYearsFromA(a);
  const [diameterKm, albedo, rotationHours] = PHYSICAL[name];
  return {
    id: `builtin-${name.toLowerCase()}`,
    name,
    designation: name,
    source: 'JPL',
    sourceDetail: 'JPL Approximate Positions of the Planets; Standish',
    centralBody: 'Sun',
    aAu: a,
    eccentricity: e,
    inclinationDeg: i,
    nodeDeg: node,
    argPerihelionDeg: longitudePerihelion - node,
    meanAnomalyDeg: longitude - longitudePerihelion,
    epochJd: J2000_JD,
    periodDays: periodYears * JULIAN_YEAR_DAYS,
    periodYears,
    moidAu: name === 'Earth' ? 0 : null,
    h: null,
    diameterKm,
    albedo,
    rotationHours,
    orbitClass: 'Planet',
    nextEarthApproach: null,
  };
}

const MOON = Object.freeze({
  id: 'builtin-moon', name: 'Moon', designation: 'Moon', source: 'JPL',
  sourceDetail: 'Standard J2000 mean lunar elements', centralBody: 'Earth',
  aAu: 384_400 / AU_KM, eccentricity: 0.0549, inclinationDeg: 5.145,
  nodeDeg: 125.08, argPerihelionDeg: 318.15, meanAnomalyDeg: 135.27,
  epochJd: J2000_JD, periodDays: 27.321661, periodYears: 27.321661 / JULIAN_YEAR_DAYS,
  moidAu: null, h: null, diameterKm: 3_474.8, albedo: 0.12,
  rotationHours: 655.72, orbitClass: 'Natural satellite', nextEarthApproach: null,
});

export const BUILT_INS = Object.freeze([...Object.keys(PLANET_ELEMENTS).map(planetRecord), MOON]);
export const BUILT_IN_BY_NAME = new Map(BUILT_INS.map(item => [item.name.toLowerCase(), item]));

export function dateToJulian(date = new Date()) {
  return date.valueOf() / 86_400_000 + 2_440_587.5;
}

function keyed(items) {
  return Object.fromEntries((Array.isArray(items) ? items : []).map(item => [item.name, item]));
}

export function objectFromSbdb(payload, now = new Date()) {
  if (!payload?.object || !payload?.orbit) return null;
  const elements = keyed(payload.orbit.elements);
  const physical = keyed(payload.phys_par);
  const a = finite(elements.a?.value);
  const e = finite(elements.e?.value);
  const keplerPeriodYears = periodYearsFromA(a);
  const periodDays = finite(elements.per?.value) ?? (keplerPeriodYears === null ? null : keplerPeriodYears * JULIAN_YEAR_DAYS);
  const closeApproaches = (Array.isArray(payload.ca_data) ? payload.ca_data : [])
    .filter(item => item.body === 'Earth')
    .map(item => ({ date: parseJplCalendarDate(item.cd), distanceAu: finite(item.dist), speedKms: finite(item.v_rel) }))
    .filter(item => item.date && item.date >= now)
    .sort((left, right) => left.date - right.date);
  return {
    id: `jpl-${payload.object.spkid || payload.object.des}`,
    name: payload.object.shortname || payload.object.fullname || payload.object.des,
    designation: payload.object.des,
    source: 'JPL',
    sourceDetail: payload.signature?.source || 'JPL Small-Body Database',
    centralBody: 'Sun',
    aAu: a,
    eccentricity: e,
    inclinationDeg: finite(elements.i?.value),
    nodeDeg: finite(elements.om?.value),
    argPerihelionDeg: finite(elements.w?.value),
    meanAnomalyDeg: finite(elements.ma?.value),
    epochJd: finite(payload.orbit.epoch),
    periodDays,
    periodYears: periodDays === null ? periodYearsFromA(a) : periodDays / JULIAN_YEAR_DAYS,
    moidAu: finite(payload.orbit.moid),
    h: finite(physical.H?.value),
    diameterKm: finite(physical.diameter?.value),
    albedo: finite(physical.albedo?.value),
    rotationHours: finite(physical.rot_per?.value),
    orbitClass: payload.object.orbit_class?.name || payload.object.orbit_class?.code || null,
    nextEarthApproach: closeApproaches[0] || null,
  };
}

export function rawPosition(object, jd) {
  const local = heliocentricPosition(object, jd);
  if (!local) return null;
  if (object.centralBody !== 'Earth') return local;
  const earth = heliocentricPosition(BUILT_IN_BY_NAME.get('earth'), jd);
  return earth ? { x: earth.x + local.x, y: earth.y + local.y, z: earth.z + local.z, r: Math.hypot(earth.x + local.x, earth.y + local.y, earth.z + local.z) } : null;
}

function finiteDifferenceSpeed(object, jd, stepDays = 0.01) {
  const before = rawPosition(object, jd - stepDays);
  const after = rawPosition(object, jd + stepDays);
  const distanceAu = distanceBetween(before, after);
  return distanceAu === null ? null : distanceAu * AU_KM / (2 * stepDays * 86_400);
}

export function deriveObject(object, now = new Date()) {
  const jd = dateToJulian(now);
  const position = rawPosition(object, jd);
  const earthPosition = rawPosition(BUILT_IN_BY_NAME.get('earth'), jd);
  const { q, Q } = perihelionAphelion(object.aAu, object.eccentricity);
  const currentSpeedKms = object.centralBody === 'Earth'
    ? finiteDifferenceSpeed(object, jd)
    : visVivaKms(object.aAu, position?.r);
  return {
    ...object,
    qAu: q,
    aphelionAu: Q,
    moidLd: object.moidAu === null ? null : object.moidAu * AU_KM / 384_400,
    position,
    currentSunDistanceAu: position?.r ?? null,
    currentEarthDistanceAu: distanceBetween(position, earthPosition),
    currentSpeedKms,
    meanSpeedKms: meanOrbitalSpeedKms(object.aAu, object.eccentricity, object.periodYears),
    computedAt: now,
  };
}

export function findBuiltIn(name) {
  return BUILT_IN_BY_NAME.get(String(name || '').trim().toLowerCase()) || null;
}
