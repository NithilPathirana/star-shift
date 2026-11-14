// HEALPix NESTED geometry for HiPS tiles (pure maths, no DOM).
// Follows the conventions of healpix_base (Gorski et al. 2005) and astropy-healpix:
// a pixel is (face, ix, iy); a point inside it is (ix + dx, iy + dy) / nside, dx, dy in [0, 1].
// Corners: (dx, dy) = (1, 1) north, (0, 1) west, (0, 0) south, (1, 0) east.
// Checked against astropy-healpix in tests/sky3d.test.mjs.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];
const HALFPI = Math.PI / 2;

// Spread the bits of a 16-bit number to even positions (and back). Plain arithmetic, so
// orders up to 13 (nside 8192) stay exact in doubles without 32-bit overflow.
function spread(v) { let r = 0, b = 1; for (let i = 0; v > 0; i++, v = Math.floor(v / 2), b *= 4) if (v & 1) r += b; return r; }
function compress(v) { let r = 0, b = 1; for (; v > 0; v = Math.floor(v / 4), b *= 2) if (v % 2) r += b; return r; }

export function nestToXYF(order, n) {
  const npface = 4 ** order;
  const face = Math.floor(n / npface), local = n - face * npface;
  return { face, ix: compress(local), iy: compress(Math.floor(local / 2)) };
}
export function xyfToNest(order, ix, iy, face) { return face * 4 ** order + spread(ix) + 2 * spread(iy); }

// Face coordinates x, y in [0, 1] -> unit vector (equatorial: x towards RA 0, z to the north pole).
export function xyfToVec(x, y, face) {
  const jr = JRLL[face] - x - y;
  let nr, z, sth = -1;
  if (jr < 1) { nr = jr; const t = (nr * nr) / 3; z = 1 - t; if (z > 0.99) sth = Math.sqrt(t * (2 - t)); }
  else if (jr > 3) { nr = 4 - jr; const t = (nr * nr) / 3; z = t - 1; if (z < -0.99) sth = Math.sqrt(t * (2 - t)); }
  else { nr = 1; z = ((2 - jr) * 2) / 3; }
  let t = JPLL[face] * nr + x - y;
  if (t < 0) t += 8; if (t >= 8) t -= 8;
  const phi = nr < 1e-15 ? 0 : (0.5 * HALFPI * t) / nr;
  if (sth < 0) sth = Math.sqrt((1 - z) * (1 + z));
  return [sth * Math.cos(phi), sth * Math.sin(phi), z];
}

// A point inside a nested pixel, dx/dy in [0, 1] (0.5, 0.5 = centre).
export function pixToVec(order, n, dx = 0.5, dy = 0.5) {
  const nside = 2 ** order, { face, ix, iy } = nestToXYF(order, n);
  return xyfToVec((ix + dx) / nside, (iy + dy) / nside, face);
}

// Unit vector -> nested pixel index.
export function vecToPix(order, v) {
  const nside = 2 ** order;
  const len = Math.hypot(v[0], v[1], v[2]);
  const z = v[2] / len, za = Math.abs(z);
  let phi = Math.atan2(v[1], v[0]);
  let tt = (phi / HALFPI) % 4; if (tt < 0) tt += 4;
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt), t2 = nside * z * 0.75;
    const jp = Math.floor(t1 - t2), jm = Math.floor(t1 + t2);
    const ifp = Math.floor(jp / nside), ifm = Math.floor(jm / nside);
    const face = ifp === ifm ? (ifp % 4) + 4 : ifp < ifm ? ifp % 4 : (ifm % 4) + 8;
    const ix = ((jm % nside) + nside) % nside, iy = nside - (((jp % nside) + nside) % nside) - 1;
    return xyfToNest(order, ix, iy, face);
  }
  const ntt = Math.min(3, Math.floor(tt)), tp = tt - ntt;
  const sth = Math.hypot(v[0], v[1]) / len;
  const tmp = za < 0.99 ? nside * Math.sqrt(3 * (1 - za)) : (nside * sth) / Math.sqrt((1 + za) / 3);
  const jp = Math.min(nside - 1, Math.floor(tp * tmp)), jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
  return z >= 0 ? xyfToNest(order, nside - jm - 1, nside - jp - 1, ntt) : xyfToNest(order, jp, jm, ntt + 8);
}

// HiPS tiles: the pixel at (column u, row v from the TOP) of a tile image, as fractions
// 0..1, sits at dx = v, dy = u inside the tile's HEALPix pixel. (Checked on real SPHEREx
// tiles: Betelgeuse, Sirius, Rigel and Vega land on their blobs; see the test file.)
export function tileUV(dx, dy) { return [dy, dx]; }

// Allsky.png (order 3): tile n is a w x w thumbnail at column n % 27, row floor(n / 27).
export const ALLSKY_COLS = 27;
export function allskyRect(n, w = 64) { return { x: (n % ALLSKY_COLS) * w, y: Math.floor(n / ALLSKY_COLS) * w, w }; }
export function tilePath(order, n) { return `Norder${order}/Dir${Math.floor(n / 10000) * 10000}/Npix${n}.png`; }

export const npix = (order) => 12 * 4 ** order;
export function children(n) { return [4 * n, 4 * n + 1, 4 * n + 2, 4 * n + 3]; }
export function parent(n, levels = 1) { return Math.floor(n / 4 ** levels); }
// Approximate largest centre-to-corner angle of a tile at this order (radians), with margin.
export function tileRadius(order) { return 1.2 * (58.6 / 2 ** order) * (Math.PI / 180); }
