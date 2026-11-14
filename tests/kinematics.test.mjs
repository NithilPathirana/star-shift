// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Tests for the Motion panel maths (team feature K, DESIGN.md 27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalPM, totalPMErr, motionPA, yearsPerPixel, distancePc, tangentialVelocity, tangentialVelocityErr,
  spaceVelocity, galacticUVW, toLSR, kinematics } from '../web/app/kinematics.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, want ${b} ± ${tol}`);
const barnard = { ra: 269.4520769586187, dec: 4.693364966576667, pmra: -801.551, pmdec: 10362.394, plx: 546.9759, rv: -110.5 };

test("Barnard's Star: vt ≈ 90 km/s, total ≈ 142 km/s", () => {
  const mu = totalPM(barnard.pmra, barnard.pmdec);
  near(mu, 10393.35, 0.05, 'total PM');
  const vt = tangentialVelocity(mu, barnard.plx);
  near(vt, 90.07, 0.1, 'vt');
  near(spaceVelocity(vt, barnard.rv), 142.5, 0.3, 'total');
  near(motionPA(barnard.pmra, barnard.pmdec), 355.58, 0.02, 'PA');
  near(yearsPerPixel(mu), 0.5965, 0.001, 'years per 6.2″ pixel');
});

test('UVW speed equals the total space speed (rotation keeps length)', () => {
  const k = kinematics(barnard);
  near(Math.hypot(k.uvw.U, k.uvw.V, k.uvw.W), k.vtot, 1e-6);
  // Barnard's Star (l ≈ 31°) is approaching, so it moves away from the Galactic centre (U < 0)
  // and north of the plane. Regression values from this code (heliocentric, no LSR correction).
  near(k.uvw.U, -141.3, 0.5, 'U'); near(k.uvw.V, 4.9, 0.5, 'V'); near(k.uvw.W, 18.5, 0.5, 'W');
});

test('UVW axes: pure radial velocity towards the Galactic centre, rotation and the pole', () => {
  const zero = { pmra: 0, pmdec: 0, plx: 100, rv: 10 };
  const gc = galacticUVW({ ...zero, ra: 266.40499, dec: -28.93617 });
  near(gc.U, 10, 1e-3); near(gc.V, 0, 1e-3); near(gc.W, 0, 1e-3);
  const ngp = galacticUVW({ ...zero, ra: 192.85948, dec: 27.12825 });
  near(ngp.W, 10, 1e-3); near(ngp.U, 0, 1e-3);
  const l90 = galacticUVW({ ...zero, ra: 318.00438, dec: 48.32963 }); // l = 90°, b = 0°
  near(l90.V, 10, 1e-3); near(l90.U, 0, 1e-3);
});

test('LSR correction adds the Schönrich 2010 solar motion', () => {
  assert.deepEqual(toLSR({ U: 0, V: 0, W: 0 }), { U: 11.1, V: 12.24, W: 7.25 });
  assert.equal(toLSR(null), null);
});

test('distance from parallax, with a weak-parallax warning below ϖ/σ = 5', () => {
  const d = distancePc(546.9759, 0.04);
  near(d.pc, 1.8282, 1e-4); near(d.ly, 5.963, 1e-3); assert.equal(d.weak, false);
  assert.equal(distancePc(1.2509, 0.4).weak, true);
  assert.equal(distancePc(1.2509).weak, false); // no error known: no claim
  assert.equal(distancePc(-0.3, 0.2), null);
  assert.equal(distancePc(null), null);
});

test('errors propagate; missing inputs give null, never 0', () => {
  near(totalPMErr(3, 4, 0.1, 0.1), 0.1, 1e-9);
  near(tangentialVelocityErr(1000, 10, 100, 1), 47.4047 * Math.hypot(0.01, 0.01), 1e-6);
  assert.equal(totalPM(0, 0), null);
  assert.equal(motionPA(null, 5), null);
  assert.equal(tangentialVelocity(1000, 0), null);
  assert.equal(spaceVelocity(50, null), null);
  const k = kinematics({ ra: 10, dec: 10, pmra: 100, pmdec: 0 });
  assert.equal(k.vt, null); assert.equal(k.vtot, null); assert.equal(k.uvw, null); assert.equal(k.dist, null);
  near(k.pa, 90, 1e-9); // due east
});
