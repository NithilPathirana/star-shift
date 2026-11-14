// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Planetarium ("Sky now") maths: frames, stars, Sun/Moon/planets, projection, places, hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, observer, bodies, horMatrix, starAltAz, altAzToRaDec, altAzToVec, vecToAltAz, passTimes, sunAltitude, refraction, bvColor, starSize, starAlpha } from '../web/app/planet/astro.js';
import { makeView, project, unproject, zoomAbout, magLimit } from '../web/app/planet/projection.js';
import { parsePlace, OBSERVATORIES, NASA_CENTRES, DEFAULT_PLACE } from '../web/app/planet/places.js';
import { registerSmallBodyProvider, smallBodies } from '../web/app/planet/extras.js';
import { altAz as simpleAltAz, sunRaDec } from '../web/app/sky.js';

const COLOMBO = observer(6.927, 79.861, 5);
const T = new Date(Date.UTC(2026, 10, 14, 15, 30)); // 21:00 Colombo time
const angSep = (a1, z1, a2, z2) => { // between two alt/az points, degrees
  const p = altAzToVec(a1, z1), q = altAzToVec(a2, z2);
  return Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])) * 180 / Math.PI;
};

test('horizon matrix is a proper rotation (orthonormal, det +1)', () => {
  const M = horMatrix(T, COLOMBO);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const d = M[i][0] * M[j][0] + M[i][1] * M[j][1] + M[i][2] * M[j][2];
    assert.ok(Math.abs(d - (i === j ? 1 : 0)) < 1e-9);
  }
  const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  assert.ok(Math.abs(det - 1) < 1e-9);
});

test('star alt/az via the matrix matches astronomy-engine (DefineStar + Horizon) to 0.01°', () => {
  const stars = [[101.2871, -16.7161], [279.2347, 38.7837], [37.9546, 89.2641], [95.988, -52.6957], [344.4127, -29.6222]];
  for (const place of [COLOMBO, observer(-24.6272, -70.4042, 2635), observer(64.1, -21.9, 0)]) {
    for (const [ra, dec] of stars) {
      const mine = starAltAz(ra, dec, T, place);
      A.DefineStar(A.Body.Star2, ra / 15, dec, 1000);
      const t = A.MakeTime(T), eq = A.Equator(A.Body.Star2, t, place, true, false);
      const h = A.Horizon(t, place, eq.ra, eq.dec, 'normal');
      if (h.altitude < 0) { assert.ok(Math.abs(((mine.az - h.azimuth + 540) % 360) - 180) < 0.01); continue; } // refraction below the horizon is not physical
      assert.ok(angSep(mine.alt, mine.az, h.altitude, h.azimuth) < 0.01, `${ra},${dec}: ${JSON.stringify(mine)} vs ${h.altitude},${h.azimuth}`);
    }
  }
});

test('star alt/az agrees with the simple J2000 formula in sky.js (differs only by precession, < 0.6°)', () => {
  for (const [ra, dec] of [[344.4127, -29.6222], [24.4285, -57.2368], [10.8974, -17.9866]]) {
    const a = starAltAz(ra, dec, T, COLOMBO), b = simpleAltAz(ra, dec, 6.927, 79.861, T);
    if (b.alt < 15) continue; // refraction grows near the horizon
    assert.ok(angSep(a.alt, a.az, b.alt, b.az) < 0.6, `${ra}: ${a.alt},${a.az} vs ${b.alt},${b.az}`);
  }
});

test('Fomalhaut from Colombo at 21:00 on 14 Nov 2026 is high in the south-southwest', () => {
  const f = starAltAz(344.4127, -29.6222, T, COLOMBO);
  assert.ok(f.alt > 45 && f.alt < 55, `alt ${f.alt}`);
  assert.ok(f.az > 190 && f.az < 215, `az ${f.az}`);
});

test('sky point -> J2000 RA/Dec round trip (with refraction) is exact to 1e-4°', () => {
  for (const [ra, dec] of [[101.2871, -16.7161], [0.5, 0.2], [210, 60], [300, -75]]) {
    const aa = starAltAz(ra, dec, T, COLOMBO);
    const back = altAzToRaDec(aa.alt, aa.az, T, COLOMBO);
    const dra = ((back.ra - ra + 540) % 360) - 180;
    assert.ok(Math.abs(dra * Math.cos(dec * Math.PI / 180)) < 1e-4 && Math.abs(back.dec - dec) < 1e-4, `${ra},${dec} -> ${back.ra},${back.dec}`);
  }
});

test('Sun position agrees with the low-precision sunRaDec + altAz in sky.js (< 0.45°: precession since J2000 plus its low precision)', () => {
  const noon = new Date(Date.UTC(2026, 10, 14, 6, 30)); // around noon in Colombo
  const sun = bodies(noon, COLOMBO).find(b => b.key === 'Sun');
  const s = sunRaDec(noon), ref = simpleAltAz(s.ra, s.dec, 6.927, 79.861, noon);
  const trueAlt = sun.alt - refraction(sun.alt); // sky.js ignores refraction
  assert.ok(ref.alt > 50);
  assert.ok(angSep(trueAlt, sun.az, ref.alt, ref.az) < 0.45, `${trueAlt},${sun.az} vs ${ref.alt},${ref.az}`);
  assert.ok(sunAltitude(noon, COLOMBO) > 50);
  assert.ok(sunAltitude(T, COLOMBO) < -40); // 21:00: night
});

test('planets: alt/az from their J2000 RA/Dec agrees to < 0.6° (precession only); all 9 bodies present', () => {
  const list = bodies(T, COLOMBO);
  assert.deepEqual(list.map(b => b.key), ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']);
  for (const b of list) {
    assert.ok(Number.isFinite(b.alt) && Number.isFinite(b.az) && Number.isFinite(b.ra) && Number.isFinite(b.dec), b.key);
    if (b.key === 'Moon') continue; // parallax up to 1°: covered by the topocentric code
    const ref = simpleAltAz(b.ra, b.dec, 6.927, 79.861, T);
    if (ref.alt < 15) continue;
    assert.ok(angSep(b.alt, b.az, ref.alt, ref.az) < 0.6, `${b.key}`);
  }
  const mags = Object.fromEntries(list.map(b => [b.key, b.mag]));
  assert.ok(mags.Venus < -3.5 && mags.Jupiter < -1.5 && mags.Neptune > 7, JSON.stringify(mags));
});

test('Moon phase: ~100% lit at full moon, ~0% at new moon (astronomy-engine search)', () => {
  const full = A.SearchMoonPhase(180, A.MakeTime(T), 40).date, nw = A.SearchMoonPhase(0, A.MakeTime(T), 40).date;
  const pf = bodies(full, COLOMBO).find(b => b.key === 'Moon').phase, pn = bodies(nw, COLOMBO).find(b => b.key === 'Moon').phase;
  assert.ok(pf > 0.99, `full ${pf}`); assert.ok(pn < 0.01, `new ${pn}`);
  const moon = bodies(T, COLOMBO).find(b => b.key === 'Moon');
  assert.ok(moon.diamDeg > 0.45 && moon.diamDeg < 0.58);
});

test('Sun rise and set in Colombo on 14 Nov 2026: about 05:58 and 17:46 local', () => {
  const morning = new Date(Date.UTC(2026, 10, 13, 20, 0)); // 01:30 local on the 14th
  const p = passTimes({ kind: 'sun', key: 'Sun' }, morning, COLOMBO);
  const local = (d) => (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440; // UTC+5:30
  assert.ok(Math.abs(local(p.rise) - (5 * 60 + 58)) < 10, `rise ${p.rise.toISOString()}`);
  assert.ok(Math.abs(local(p.set) - (17 * 60 + 46)) < 10, `set ${p.set.toISOString()}`);
  assert.ok(p.transitAlt > 60 && p.transitAlt < 80);
});

test('circumpolar and never-rising stars are reported, not guessed', () => {
  const north = observer(64.1, -21.9, 0);
  assert.equal(passTimes({ kind: 'star', ra: 37.9546, dec: 89.2641 }, T, north).always, 'up');      // Polaris from Iceland
  assert.equal(passTimes({ kind: 'star', ra: 95.988, dec: -52.6957 }, T, north).always, 'down');    // Canopus from Iceland
});

test('stereographic projection: centre, round trip, radius law, zoom anchor', () => {
  const v = makeView({ az: 180, alt: 40, fov: 90, w: 1000, h: 600 });
  const c = project(v, ...altAzToVec(40, 180));
  assert.ok(Math.abs(c[0] - 500) < 1e-9 && Math.abs(c[1] - 300) < 1e-9);
  const e = project(v, ...altAzToVec(40, 200)); assert.ok(e[0] > 500, 'larger azimuth is to the right when facing south');
  const up = project(v, ...altAzToVec(60, 180)); assert.ok(up[1] < 300, 'higher altitude is up');
  // half the fov across the shorter side lands on the edge (radius = 2·tan(θ/2)·scale)
  const top = project(v, ...altAzToVec(85, 180)); assert.ok(Math.abs(top[1] - 0) < 1e-6, `top ${top[1]}`);
  for (const [x, y] of [[10, 20], [500, 300], [990, 590], [123, 456]]) {
    const p = unproject(v, x, y), q = project(v, ...p);
    assert.ok(Math.abs(q[0] - x) < 1e-6 && Math.abs(q[1] - y) < 1e-6);
  }
  const target = vecToAltAz(...unproject(v, 800, 150));
  const nc = zoomAbout(v, 800, 150, 30), v2 = makeView({ az: nc.az, alt: nc.alt, fov: 30, w: 1000, h: 600 });
  const q = project(v2, ...altAzToVec(target.alt, target.az));
  assert.ok(Math.hypot(q[0] - 800, q[1] - 150) < 3, `zoom anchor moved to ${q}`);
  assert.equal(project(v, ...altAzToVec(-40, 0)), null); // straight behind
  assert.ok(magLimit(90) >= 6.5 && magLimit(5) > magLimit(90));
});

test('star look follows DESIGN.md section 18', () => {
  assert.equal(bvColor(0), 'rgb(238,240,242)');
  assert.equal(bvColor(1.2), 'rgb(255,196,140)');
  assert.equal(bvColor(-1), 'rgb(180,200,255)');
  assert.equal(starSize(-1.44), 7); assert.equal(starSize(9), 1.2);
  assert.ok(Math.abs(starAlpha(-1.5) - 1) < 1e-9 && starAlpha(8) === 0.25);
});

test('places: presets present, coordinates and city parsing, error wording', () => {
  assert.equal(OBSERVATORIES.length, 9); assert.equal(NASA_CENTRES.length, 10);
  assert.equal(DEFAULT_PLACE.name, 'Colombo');
  for (const p of [...OBSERVATORIES, ...NASA_CENTRES]) assert.ok(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && p.tz, p.id);
  assert.deepEqual([parsePlace('6.93, 79.86').place.lat, parsePlace('6.93, 79.86').place.lon], [6.93, 79.86]);
  const s = parsePlace('33.92 S, 18.42 E').place; assert.deepEqual([s.lat, s.lon], [-33.92, 18.42]);
  const w = parsePlace('-24.6 -70.4').place; assert.deepEqual([w.lat, w.lon], [-24.6, -70.4]);
  assert.equal(parsePlace('colombo').place.id, 'colombo');
  assert.equal(parsePlace('Sao Paulo').place.id, 'saopaulo');
  assert.match(parsePlace('91, 10').error, /between −90 and 90/);
  assert.equal(parsePlace('Atlantis').error, 'We don\'t know “Atlantis”. Type a big city (e.g. Colombo, London) or latitude, longitude like 6.93, 79.86.');
  assert.equal(parsePlace('6.93, 79.86').place.tz, null); // no time zone guessed for typed coordinates
});

test('small-body hook: keeps good rows, drops bad rows and failing providers, gets only the time', async () => {
  let seen = null;
  const off1 = registerSmallBodyProvider(async (...args) => { seen = args; return [{ name: '4 Vesta', ra: 120, dec: 10, mag: 6.2 }, { name: 'bad', ra: NaN, dec: 0 }, null]; });
  const off2 = registerSmallBodyProvider(async () => { throw new Error('down'); });
  const list = await smallBodies(T);
  assert.equal(seen.length, 1); assert.ok(seen[0] instanceof Date);
  assert.deepEqual(list.map(b => [b.name, b.kind, b.source, b.mag, b.distAU]), [['4 Vesta', 'small', 'JPL', 6.2, null]]);
  off1(); off2();
  assert.equal((await smallBodies(T)).length, 0);
});
