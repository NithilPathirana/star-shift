// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026

export const AU_KM = 149_597_870.7;
export const GM_SUN_KM3_S2 = 132_712_440_018;
export const JULIAN_YEAR_DAYS = 365.25;
export const J2000_JD = 2_451_545;

export const toRadians = degrees => degrees * Math.PI / 180;
export const toDegrees = radians => radians * 180 / Math.PI;

export function normaliseRadians(value) {
  const turn = Math.PI * 2;
  return ((value % turn) + turn) % turn;
}

export function solveKepler(meanAnomaly, eccentricity, tolerance = 1e-12, maxIterations = 30) {
  if (!Number.isFinite(meanAnomaly) || !(eccentricity >= 0 && eccentricity < 1)) return null;
  const mean = normaliseRadians(meanAnomaly);
  let eccentricAnomaly = eccentricity < 0.8 ? mean : Math.PI;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const delta = (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - mean)
      / (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= delta;
    if (Math.abs(delta) <= tolerance) return eccentricAnomaly;
  }
  return eccentricAnomaly;
}

export function periodYearsFromA(aAu) {
  return Number.isFinite(aAu) && aAu > 0 ? Math.sqrt(aAu ** 3) : null;
}

export function perihelionAphelion(aAu, eccentricity) {
  if (!(aAu > 0) || !(eccentricity >= 0 && eccentricity < 1)) return { q: null, Q: null };
  return { q: aAu * (1 - eccentricity), Q: aAu * (1 + eccentricity) };
}

export function meanAnomalyAt(elements, jd) {
  const epoch = Number(elements.epochJd ?? J2000_JD);
  const initial = Number(elements.meanAnomalyDeg ?? elements.M ?? 0);
  const periodDays = Number(elements.periodDays ?? (periodYearsFromA(Number(elements.aAu ?? elements.a)) * JULIAN_YEAR_DAYS));
  if (!Number.isFinite(jd) || !Number.isFinite(epoch) || !(periodDays > 0)) return null;
  return normaliseRadians(toRadians(initial + 360 * (jd - epoch) / periodDays));
}

export function positionAtMeanAnomaly(elements, meanAnomaly) {
  const a = Number(elements.aAu ?? elements.a);
  const e = Number(elements.eccentricity ?? elements.e);
  const inclination = toRadians(Number(elements.inclinationDeg ?? elements.i ?? 0));
  const node = toRadians(Number(elements.nodeDeg ?? elements.node ?? elements.om ?? 0));
  const peri = toRadians(Number(elements.argPerihelionDeg ?? elements.w ?? 0));
  if (!(a > 0) || !(e >= 0 && e < 1) || !Number.isFinite(meanAnomaly)) return null;

  const E = solveKepler(meanAnomaly, e);
  if (E === null) return null;
  const orbitalX = a * (Math.cos(E) - e);
  const orbitalY = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cosNode = Math.cos(node), sinNode = Math.sin(node);
  const cosPeri = Math.cos(peri), sinPeri = Math.sin(peri);
  const cosI = Math.cos(inclination), sinI = Math.sin(inclination);
  const x = (cosNode * cosPeri - sinNode * sinPeri * cosI) * orbitalX
    + (-cosNode * sinPeri - sinNode * cosPeri * cosI) * orbitalY;
  const y = (sinNode * cosPeri + cosNode * sinPeri * cosI) * orbitalX
    + (-sinNode * sinPeri + cosNode * cosPeri * cosI) * orbitalY;
  const z = sinPeri * sinI * orbitalX + cosPeri * sinI * orbitalY;
  return { x, y, z, r: Math.hypot(x, y, z), eccentricAnomaly: E };
}

export function heliocentricPosition(elements, jd) {
  const meanAnomaly = meanAnomalyAt(elements, jd);
  return meanAnomaly === null ? null : positionAtMeanAnomaly(elements, meanAnomaly);
}

export function visVivaKms(aAu, rAu, gm = GM_SUN_KM3_S2) {
  if (!(aAu > 0) || !(rAu > 0) || !(gm > 0)) return null;
  const term = 2 / (rAu * AU_KM) - 1 / (aAu * AU_KM);
  return term > 0 ? Math.sqrt(gm * term) : null;
}

export function meanOrbitalSpeedKms(aAu, eccentricity, periodYears = periodYearsFromA(aAu)) {
  if (!(aAu > 0) || !(eccentricity >= 0 && eccentricity < 1) || !(periodYears > 0)) return null;
  const b = aAu * Math.sqrt(1 - eccentricity * eccentricity);
  const circumferenceAu = Math.PI * (3 * (aAu + b) - Math.sqrt((3 * aAu + b) * (aAu + 3 * b)));
  return circumferenceAu * AU_KM / (periodYears * JULIAN_YEAR_DAYS * 86_400);
}

export function distanceBetween(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

