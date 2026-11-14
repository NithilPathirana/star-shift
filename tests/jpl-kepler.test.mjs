// AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  heliocentricPosition, meanOrbitalSpeedKms, periodYearsFromA,
  perihelionAphelion, solveKepler, toRadians, visVivaKms,
} from '../web/app/orbits/kepler.js';
import { objectFromSbdb } from '../web/app/orbits/model.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/jpl/${name}.json`, import.meta.url), 'utf8'));
const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

test('Kepler solver satisfies M = E - e sin(E)', () => {
  const M = toRadians(123);
  const e = 0.71;
  const E = solveKepler(M, e);
  close(E - e * Math.sin(E), M, 1e-11);
  assert.equal(solveKepler(0, 1.1), null);
});

test('Earth-like orbit is about 1 au and 29.8 km/s', () => {
  const earth = { aAu: 1, eccentricity: 0.0167, inclinationDeg: 0, nodeDeg: 0, argPerihelionDeg: 102.9, meanAnomalyDeg: 0, epochJd: 2451545, periodDays: 365.256 };
  const position = heliocentricPosition(earth, 2451545 + 365.256 / 4);
  assert.ok(position.r > 0.98 && position.r < 1.02);
  close(visVivaKms(1, 1), 29.7847, 0.02);
  close(meanOrbitalSpeedKms(1, 0.0167), 29.78, 0.05);
});

test('Ceres period is approximately 4.6 years', () => {
  const ceres = objectFromSbdb(fixture('sbdb_ceres'));
  close(ceres.periodYears, 1680 / 365.25, 1e-12);
  close(periodYearsFromA(ceres.aAu), 4.61, 0.03);
});

test('Halley fixture gives its high eccentricity and roughly 0.59 au perihelion', () => {
  const halley = objectFromSbdb(fixture('sbdb_halley'));
  close(halley.eccentricity, 0.968, 1e-12);
  const { q, Q } = perihelionAphelion(halley.aAu, halley.eccentricity);
  close(q, 0.575, 0.02);
  close(Q, 35.3, 0.2);
});

