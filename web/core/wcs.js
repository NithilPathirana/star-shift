// TAN-SIP world coordinate system (FITS standard + SIP convention, as used by SPHEREx).
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
// Pixel coordinates here are 0-based (first pixel centre = 0), like Astropy's *_pix2world(..., 0).

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function sipCoeffs(h, prefix) {
  const order = h[prefix + '_ORDER'];
  if (order == null) return null;
  const terms = [];
  for (let p = 0; p <= order; p++) {
    for (let q = 0; q <= order - p; q++) {
      const c = h[`${prefix}_${p}_${q}`];
      if (c) terms.push([p, q, c]);
    }
  }
  return terms;
}

function poly(terms, u, v) {
  if (!terms) return 0;
  let s = 0;
  for (const [p, q, c] of terms) s += c * u ** p * v ** q;
  return s;
}

// Gnomonic (TAN) projection about (ra0, dec0). Angles in degrees; xi/eta in degrees.
export function tanProject(ra, dec, ra0, dec0) {
  const a = ra * D2R, d = dec * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R;
  const da = a - a0;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  const xi = (Math.cos(d) * Math.sin(da)) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosc;
  return [xi * R2D, eta * R2D];
}

export function tanDeproject(xiDeg, etaDeg, ra0, dec0) {
  const xi = xiDeg * D2R, eta = etaDeg * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R;
  const den = Math.cos(d0) - eta * Math.sin(d0);
  let ra = (a0 + Math.atan2(xi, den)) * R2D;
  const dec = Math.atan2(eta * Math.cos(d0) + Math.sin(d0), Math.hypot(xi, den)) * R2D;
  ra = ((ra % 360) + 360) % 360;
  return [ra, dec];
}

export class TanSip {
  constructor(h) {
    if (!String(h.CTYPE1 || '').startsWith('RA---TAN')) throw new Error('Not a TAN WCS: ' + h.CTYPE1);
    this.crpix = [h.CRPIX1, h.CRPIX2];
    this.crval = [h.CRVAL1, h.CRVAL2];
    const c1 = h.CDELT1 ?? 1, c2 = h.CDELT2 ?? 1;
    if (h.CD1_1 != null) {
      this.cd = [[h.CD1_1, h.CD1_2 ?? 0], [h.CD2_1 ?? 0, h.CD2_2]];
    } else {
      this.cd = [[(h.PC1_1 ?? 1) * c1, (h.PC1_2 ?? 0) * c1], [(h.PC2_1 ?? 0) * c2, (h.PC2_2 ?? 1) * c2]];
    }
    const [[a, b], [c, d]] = this.cd;
    const det = a * d - b * c;
    this.cdInv = [[d / det, -b / det], [-c / det, a / det]];
    if ((h.LONPOLE ?? 180) !== 180) throw new Error('Only LONPOLE=180 supported');
    this.A = sipCoeffs(h, 'A');
    this.B = sipCoeffs(h, 'B');
    this.AP = sipCoeffs(h, 'AP');
    this.BP = sipCoeffs(h, 'BP');
  }

  pixToWorld(x, y) {
    const u = x + 1 - this.crpix[0];
    const v = y + 1 - this.crpix[1];
    const U = u + poly(this.A, u, v);
    const V = v + poly(this.B, u, v);
    const xi = this.cd[0][0] * U + this.cd[0][1] * V;
    const eta = this.cd[1][0] * U + this.cd[1][1] * V;
    return tanDeproject(xi, eta, this.crval[0], this.crval[1]);
  }

  worldToPix(ra, dec) {
    const [xi, eta] = tanProject(ra, dec, this.crval[0], this.crval[1]);
    const U = this.cdInv[0][0] * xi + this.cdInv[0][1] * eta;
    const V = this.cdInv[1][0] * xi + this.cdInv[1][1] * eta;
    // Start from the inverse polynomial (AP/BP), then refine so pixToWorld round-trips exactly.
    let u = U + poly(this.AP, U, V);
    let v = V + poly(this.BP, U, V);
    for (let i = 0; i < 20; i++) {
      const nu = U - poly(this.A, u, v);
      const nv = V - poly(this.B, u, v);
      const done = Math.abs(nu - u) < 1e-10 && Math.abs(nv - v) < 1e-10;
      u = nu; v = nv;
      if (done) break;
    }
    return [u + this.crpix[0] - 1, v + this.crpix[1] - 1];
  }

  // Pixel scale in arcsec (geometric mean), ignoring SIP.
  get scaleArcsec() {
    const [[a, b], [c, d]] = this.cd;
    return Math.sqrt(Math.abs(a * d - b * c)) * 3600;
  }
}
