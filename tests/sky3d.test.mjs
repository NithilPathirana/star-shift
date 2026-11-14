// Tests for the 3D sky maths: HEALPix NESTED geometry (against astropy-healpix 2.0.1
// reference values), HiPS tile orientation, projection round trips, picking and level choice.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pixToVec, vecToPix, nestToXYF, xyfToNest, tileUV, allskyRect, tilePath, parent, children } from '../web/app/sky3d/healpix.js';
import { radecToVec, vecToRadec, frame, project, unproject, chooseOrder, visibleTiles, pickStar, starColor, starSize, starBright, magLimit, detailRamp, easeInOut, slerpRadec, panned, imageryAlpha, starAlpha, vfov, gridStep, dot, pickNearest, namesQuery } from '../web/app/sky3d/view.js';
import { propagate, NAMES } from '../tools/make_stars.mjs';

// Made with astropy_healpix.healpix_to_lonlat / lonlat_to_healpix (order='nested').
const REF = {"p2a":[[0,11,0.897,0.776,320.445,-12.5915905],[0,7,0.225,0.3,266.625,-18.4614583],[0,3,0.005,0.821,278.28,33.4127611],[0,10,0.797,0.468,239.805,-29.3405816],[0,9,0.278,0.255,136.9418386,-64.864213],[1,14,0.445,0.505,291.15,40.5416019],[1,27,0.996,0.793,184.5675,36.6077409],[1,26,0.622,0.989,149.2425,11.7514581],[1,22,0.16,0.613,57.3075,-4.3395283],[1,10,0.044,0.036,202.68,21.100196],[3,108,0.466,0.917,104.7302403,50.5297492],[3,395,0.629,0.514,169.396875,-13.7734447],[3,204,0.248,0.012,316.3275,20.7934444],[3,381,0.192,0.692,92.8125,29.362493],[3,677,0.37,0.004,221.1310008,-45.7902789],[5,2465,0.83,0.154,232.981875,38.6577259],[5,6559,0.88,0.51,197.3953125,4.0498859],[5,3288,0.847,0.64,318.1035937,29.2954042],[5,517,0.091,0.541,26.0859375,24.1420318],[5,9114,0.508,0.871,34.6457812,-18.9920829],[9,2158036,0.598,0.059,40.5856759,-50.6104062],[9,1136438,0.388,0.323,42.2811035,0.8737199],[9,709837,0.816,0.379,206.8810452,53.3985666],[9,472487,0.979,0.59,140.4250528,60.5826819],[9,1382504,0.638,0.676,115.4849414,-10.8590297]],"a2p":[[0,90,0,0],[0,90,3,63],[0,90,5,1023],[0,90,12,16777215],[0,-90,0,8],[0,-90,3,512],[0,-90,5,8192],[0,-90,12,134217728],[88.7929,7.4071,0,5],[88.7929,7.4071,3,368],[88.7929,7.4071,5,5902],[88.7929,7.4071,12,96710937],[101.287,-16.716,0,5],[101.287,-16.716,3,327],[101.287,-16.716,5,5235],[101.287,-16.716,12,85770460],[279.2347,38.7837,0,3],[279.2347,38.7837,3,232],[279.2347,38.7837,5,3726],[279.2347,38.7837,12,61056746],[10,41.9,0,0],[10,41.9,3,42],[10,41.9,5,677],[10,41.9,12,11098835],[359.99,-41.9,0,11],[359.99,-41.9,3,725],[359.99,-41.9,5,11605],[359.99,-41.9,12,190141760],[200,70,0,2],[200,70,3,187],[200,70,5,2993],[200,70,12,49049520],[45,-75,0,8],[45,-75,3,515],[45,-75,5,8243],[45,-75,12,135053564],[300,0.1,0,7],[300,0.1,3,470],[300,0.1,5,7526],[300,0.1,12,123312964],[54.2837,-6.8559,0,5],[54.2837,-6.8559,3,360],[54.2837,-6.8559,5,5762],[54.2837,-6.8559,12,94416285],[86.243,-11.2449,0,5],[86.243,-11.2449,3,334],[86.243,-11.2449,5,5345],[86.243,-11.2449,12,87586651],[34.8135,69.3344,0,0],[34.8135,69.3344,3,57],[34.8135,69.3344,5,925],[34.8135,69.3344,12,15164714],[77.4015,20.0921,0,5],[77.4015,20.0921,3,378],[77.4015,20.0921,5,6053],[77.4015,20.0921,12,99186337],[108.1512,48.4307,0,1],[108.1512,48.4307,3,108],[108.1512,48.4307,5,1737],[108.1512,48.4307,12,28466707],[238.3973,-47.4569,0,10],[238.3973,-47.4569,3,664],[238.3973,-47.4569,5,10630],[238.3973,-47.4569,12,174174185],[304.2268,62.8602,0,3],[304.2268,62.8602,3,249],[304.2268,62.8602,5,3986],[304.2268,62.8602,12,65310801],[325.41,8.0153,0,4],[325.41,8.0153,3,299],[325.41,8.0153,5,4799],[325.41,8.0153,12,78635548],[52.3656,-37.9572,0,8],[52.3656,-37.9572,3,538],[52.3656,-37.9572,5,8621],[52.3656,-37.9572,12,141260027],[334.046,6.0072,0,4],[334.046,6.0072,3,300],[334.046,6.0072,5,4811],[334.046,6.0072,12,78833336]]};

const angDeg = (a, b) => { const p = radecToVec(...a), q = radecToVec(...b); return 2 * Math.asin(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 2) * 180 / Math.PI; };

test('pixel + offsets -> position matches astropy-healpix', () => {
  for (const [order, n, dx, dy, ra, dec] of REF.p2a) {
    const got = vecToRadec(pixToVec(order, n, dx, dy));
    assert.ok(angDeg(got, [ra, dec]) < 1e-6, `order ${order} pix ${n} (${dx},${dy}): got ${got}, want ${ra},${dec}`);
  }
});

test('position -> nested pixel matches astropy-healpix', () => {
  for (const [ra, dec, order, n] of REF.a2p) assert.equal(vecToPix(order, radecToVec(ra, dec)), n, `${ra},${dec} order ${order}`);
});

test('nested index <-> (face, ix, iy) round trip; parents and children', () => {
  for (const order of [0, 3, 5, 9]) for (const n of [0, 1, 7, 4 ** order * 5 + 3, 12 * 4 ** order - 1]) {
    const { face, ix, iy } = nestToXYF(order, n);
    assert.equal(xyfToNest(order, ix, iy, face), n);
  }
  assert.deepEqual(children(5), [20, 21, 22, 23]);
  assert.equal(parent(23), 5); assert.equal(parent(95, 2), 5);
  const v = pixToVec(5, 5902, 0.3, 0.7); // a point inside a child tile lies inside the parent tile
  assert.equal(vecToPix(3, v), parent(5902, 2));
});

test('HiPS tile orientation: column = dy, row from top = dx (real SPHEREx tiles)', () => {
  // Brightest blob found in /hips/spherex/33 tiles vs astropy offsets (14 Nov 2026):
  // Sirius o5 n=5235, Vega o5 n=3726, Rigel o5 n=5696, Betelgeuse o3 n=368.
  for (const [dx, dy, col, row] of [[0.110, 0.084, 0.074, 0.082], [0.317, 0.750, 0.760, 0.305], [0.535, 0.617, 0.627, 0.537], [0.666, 0.881, 0.887, 0.668]]) {
    const [u, v] = tileUV(dx, dy);
    assert.ok(Math.abs(u - col) < 0.04 && Math.abs(v - row) < 0.04, `${dx},${dy} -> ${u},${v}`);
  }
  assert.equal(vecToPix(5, radecToVec(101.287, -16.716)), 5235);
  assert.deepEqual(allskyRect(0), { x: 0, y: 0, w: 64 });
  assert.deepEqual(allskyRect(28), { x: 64, y: 64, w: 64 });
  assert.equal(tilePath(5, 12345), 'Norder5/Dir10000/Npix12345.png');
});

test('stereographic projection: centre, north up, east left, round trip, behind, conformal', () => {
  const view = { ra: 88.79, dec: 7.41, fov: 30, w: 1000, h: 600 };
  const c = project(view, radecToVec(88.79, 7.41));
  assert.ok(Math.abs(c[0] - 500) < 1e-6 && Math.abs(c[1] - 300) < 1e-6);
  assert.ok(project(view, radecToVec(88.79, 12))[1] < 300, 'north is up');
  assert.ok(project(view, radecToVec(93, 7.41))[0] < 500, 'east (higher RA) is left');
  assert.equal(project(view, radecToVec(268.79, -7.41)), null, 'opposite side is behind');
  for (const [x, y] of [[0, 0], [1000, 600], [123, 456], [999, 1]]) {
    const p = project(view, unproject(view, x, y));
    assert.ok(Math.hypot(p[0] - x, p[1] - y) < 1e-6);
  }
  const l = vecToRadec(unproject(view, 0, 300)), r = vecToRadec(unproject(view, 1000, 300));
  assert.ok(Math.abs(angDeg(l, r) - 30) < 1e-6, 'fov is the angle across the width');
  assert.ok(Math.abs(vfov(30, 1000, 1000) - 30) < 1e-9);
  // conformal: a small circle 40° off-centre on a tall phone stays round (perspective would stretch it ~1.7x)
  const ph = { ra: 0, dec: 0, fov: 60, w: 390, h: 844 }, c0 = [0, 40], d = 0.2;
  const pc = project(ph, radecToVec(...c0)), pn = project(ph, radecToVec(0, 40 + d)), pe = project(ph, radecToVec(d / Math.cos(40 * Math.PI / 180), 40));
  const rn = Math.hypot(pn[0] - pc[0], pn[1] - pc[1]), re = Math.hypot(pe[0] - pc[0], pe[1] - pc[1]);
  assert.ok(Math.abs(rn / re - 1) < 0.01, 'round: ' + rn / re);
  const f = frame(10, 89.999); // still a valid frame near the pole
  assert.ok(Math.abs(dot(f.right, f.up)) < 1e-9 && Math.abs(dot(f.f, f.up)) < 1e-9);
});

test('level of detail: allsky when wide, sharper orders as you zoom, capped at 5', () => {
  const v = (fov) => ({ ra: 0, dec: 0, fov, w: 1366, h: 768 });
  assert.equal(chooseOrder(v(90)), 0);
  assert.equal(chooseOrder(v(20)), 0, 'no tiles at 20° and wider');
  assert.equal(chooseOrder(v(19)), 3);
  assert.equal(chooseOrder(v(10)), 4);
  assert.equal(chooseOrder(v(5)), 5);
  assert.equal(chooseOrder(v(0.1)), 5);
  assert.ok(chooseOrder(v(10), 2) >= chooseOrder(v(10), 1));
});

test('visible tiles: centre tile first, none far away, every screen corner covered', () => {
  const view = { ra: 88.79, dec: 7.41, fov: 3, w: 1366, h: 768 };
  const t = visibleTiles(view, 5);
  assert.equal(t[0], vecToPix(5, radecToVec(88.79, 7.41)));
  assert.ok(t.length >= 4 && t.length < 40, 'count ' + t.length);
  for (const n of t) assert.ok(angDeg(vecToRadec(pixToVec(5, n)), [88.79, 7.41]) < 6);
  for (const [x, y] of [[0, 0], [1366, 0], [0, 768], [1366, 768]]) assert.ok(t.includes(vecToPix(5, unproject(view, x, y))));
  const polar = { ra: 0, dec: 89.5, fov: 8, w: 1366, h: 768 };
  const tp = visibleTiles(polar, 4);
  for (const [x, y] of [[0, 0], [1366, 0], [0, 768], [1366, 768], [683, 384]]) assert.ok(tp.includes(vecToPix(4, unproject(polar, x, y))));
});

test('star picking finds the nearest bright star, and nothing when far', () => {
  const pts = [[88.79, 7.41, 0.45], [88.9, 7.45, 5.5], [10, 10, 1]];
  const x = new Float32Array(pts.flatMap(p => radecToVec(p[0], p[1]))), mag = new Float32Array(pts.map(p => p[2]));
  assert.equal(pickStar({ x, mag }, radecToVec(88.8, 7.41), 0.2 * Math.PI / 180), 0);
  assert.equal(pickStar({ x, mag }, radecToVec(88.9, 7.45), 0.02 * Math.PI / 180), 1);
  assert.equal(pickStar({ x, mag }, radecToVec(200, -40), 1 * Math.PI / 180), -1);
});

test('SIMBAD hover helpers: nearest object within the radius; names only below 1.5°', () => {
  const vecs = [radecToVec(10, 10), radecToVec(10.01, 10), radecToVec(50, 0)];
  assert.equal(pickNearest(vecs, radecToVec(10.009, 10), 0.005 * Math.PI / 180).i, 1);
  assert.equal(pickNearest(vecs, radecToVec(20, 10), 0.01 * Math.PI / 180), null);
  assert.equal(namesQuery(2), null);
  assert.deepEqual(namesQuery(1), { radius: 0.75, limit: 80 });
  assert.deepEqual(namesQuery(0.1), { radius: Math.min(1.1, 0.1 * 0.75), limit: 60 });
});

test('star look follows DESIGN.md section 18 (colour stops, size, brightness)', () => {
  const hex = (c) => c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  assert.equal(hex(starColor(-0.5)), 'b4c8ff'); assert.equal(hex(starColor(0)), 'eef0f2');
  assert.equal(hex(starColor(0.8)), 'ffddb0'); assert.equal(hex(starColor(3)), 'ffa86e');
  assert.equal(hex(starColor(0.2)), hex([0.5 * (0xee + 0xff) / 255, 0.5 * (0xf0 + 0xf1) / 255, 0.5 * (0xf2 + 0xdd) / 255]));
  assert.ok(Math.abs(starSize(6.5) - 1.2) < 1e-9 && starSize(-1.5) === 7 && Math.abs(starSize(4) - 3.325) < 1e-9);
  assert.ok(Math.abs(starBright(-1.5) - 1) < 1e-9 && starBright(5) === 0.25 && Math.abs(starBright(0) - 10 ** (-0.14 * 1.5)) < 1e-9);
  assert.ok(magLimit(100) === 5 && Math.abs(magLimit(10) - 6.9) < 1e-9 && magLimit(40) > 5 && magLimit(40) < 6.9);
});

test('motion helpers: slerp endpoints, pan direction, fades, grid step', () => {
  const a = { ra: 350, dec: 10 }, b = { ra: 10, dec: 20 };
  const s0 = slerpRadec(a, b, 0); assert.ok(angDeg([s0.ra, s0.dec], [350, 10]) < 1e-6);
  const m = slerpRadec(a, b, 0.5); assert.ok(m.ra > 355 || m.ra < 5, 'shortest way across RA 0');
  const p = panned({ ra: 100, dec: 0, fov: 10 }, 0.1, 0.1);
  assert.ok(p.ra > 100 && p.dec > 0, '+x east, +y north');
  assert.ok(imageryAlpha(60) === 0.4 && imageryAlpha(8) === 1 && detailRamp(20) === 0 && detailRamp(5) === 1);
  assert.ok(starAlpha(60) === 1 && Math.abs(starAlpha(0.5) - 0.3) < 1e-12);
  assert.ok(easeInOut(0) === 0 && easeInOut(1) === 1 && easeInOut(0.5) > 0.45 && easeInOut(0.5) < 0.65 && easeInOut(0.6) > easeInOut(0.5) && easeInOut(0.2) < 0.1);
  assert.equal(gridStep(60), 15); assert.ok(gridStep(0.5) <= 0.125);
});

test('stars.json: Hipparcos stars, sane count, named bright stars at the right places', () => {
  const d = JSON.parse(readFileSync(new URL('../web/app/data/stars.json', import.meta.url)));
  assert.ok(d.stars.length > 9000 && d.stars.length < 15500, 'count ' + d.stars.length);
  assert.match(d.credit, /Hipparcos/);
  const byName = (nm) => d.stars.find(s => d.names[s[0]] === nm);
  assert.ok(angDeg([byName('Sirius')[1], byName('Sirius')[2]], [101.287, -16.716]) < 0.02);
  assert.ok(angDeg([byName('Betelgeuse')[1], byName('Betelgeuse')[2]], [88.793, 7.407]) < 0.02);
  assert.ok(angDeg([byName('Polaris')[1], byName('Polaris')[2]], [37.95, 89.26]) < 0.05);
  assert.ok(byName('Sirius')[3] < -1.3 && byName('Vega')[4] < 0.1 && byName('Betelgeuse')[4] > 1.4);
  assert.ok(Object.keys(NAMES).length >= 100 && Object.keys(d.names).length >= 100);
  const [r, de] = propagate(0, 0, 3600, 3600, 1); // 3600 mas/yr = 0.001 deg/yr, for 1 yr
  assert.ok(Math.abs(r - 0.001) < 1e-12 && Math.abs(de - 0.001) < 1e-12);
});
