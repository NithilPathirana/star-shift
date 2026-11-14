// Wavelength seen at a cutout pixel (SPHEREx linear variable filters: the wavelength
// changes across each detector). Implements the FITS -TAB lookup used by the
// "W" alternate WCS in SPHEREx image headers, with the WCS-WAVE table per detector.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

function fracIndex(grid, v) {
  // grid is increasing; returns fractional 0-based index (linear extrapolation outside).
  const n = grid.length;
  let i = 0;
  while (i < n - 2 && v > grid[i + 1]) i++;
  return i + (v - grid[i]) / (grid[i + 1] - grid[i]);
}

// table: { X: [..], Y: [..], VALUES: [iy][ix][m] } (m=0 wavelength um, m=1 bandwidth um)
export function lookupWave(table, psiX, psiY) {
  const fx = fracIndex(table.X, psiX), fy = fracIndex(table.Y, psiY);
  const nx = table.X.length, ny = table.Y.length;
  const ix = Math.min(Math.max(Math.floor(fx), 0), nx - 2);
  const iy = Math.min(Math.max(Math.floor(fy), 0), ny - 2);
  const tx = fx - ix, ty = fy - iy;
  const V = table.VALUES;
  const at = (m) =>
    (1 - tx) * (1 - ty) * V[iy][ix][m] + tx * (1 - ty) * V[iy][ix + 1][m] +
    (1 - tx) * ty * V[iy + 1][ix][m] + tx * ty * V[iy + 1][ix + 1][m];
  return { wavelength: at(0), bandwidth: at(1) };
}

// x, y: 0-based cutout pixel. header: IMAGE header (holds the "W" keywords).
export function wavelengthAt(header, table, x, y) {
  const psiX = (header.CRVAL1W ?? 1) + (header.CDELT1W ?? 1) * (x + 1 - header.CRPIX1W);
  const psiY = (header.CRVAL2W ?? 1) + (header.CDELT2W ?? 1) * (y + 1 - header.CRPIX2W);
  return lookupWave(table, psiX, psiY);
}
