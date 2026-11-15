// Which object the dashed "where it should be" ring belongs to, and where it sits on each image.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// Bug (Nithil, Sun 15 Nov): a patch clicked about 1′ south of Barnard's Star drew the ring at the
// patch centre (empty sky) while Barnard's Star sat at the top edge. A coordinate patch has no star
// of its own, so a ring at its centre means nothing. Now:
//  - a named target (preset or SIMBAD star): its own predicted position (unchanged);
//  - a coordinate patch with a demo star inside it: that star's predicted position on each image's
//    date, mapped onto the same grid the image is reprojected onto (each image's own WCS), and named;
//  - a coordinate patch with no catalogued star: no ring at all.
import { propagate } from '../core/motion.js';
import { worldToGrid } from '../core/align.js';

// target: from resolveTarget (source 'coordinates' for a typed/clicked patch); grid: makeGrid();
// midMjd: middle of the loaded images' dates; presets: PRESETS from presets.js.
export function ringObject(target, grid, midMjd, presets) {
  if (!target || !grid) return null;
  if (target.source !== 'coordinates') return { name: null, own: true };
  const half = grid.c; // pixels from centre to edge
  let best = null;
  for (const p of presets) {
    const q = propagate(p.target, midMjd), [x, y] = worldToGrid(grid, q.ra, q.dec);
    const d = Math.hypot(x - grid.c, y - grid.c);
    if (d <= half && (!best || d < best.d)) best = { name: p.label, t: p.target, d };
  }
  return best ? { name: best.name, t: best.t, own: false } : null;
}

// Grid position of a borrowed object's ring on one image's date, or null when it is off the image.
export function ringAt(grid, obj, mjd) {
  if (!obj?.t) return null;
  const p = propagate(obj.t, mjd);
  const [x, y] = worldToGrid(grid, p.ra, p.dec);
  const n = 2 * grid.c + 1;
  return x >= -0.5 && y >= -0.5 && x <= n - 0.5 && y <= n - 0.5 ? [x, y] : null;
}
