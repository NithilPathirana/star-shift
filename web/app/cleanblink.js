// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// "Clean Blink": one toggle in the Blink view that hides every overlay (flag hatching and marks,
// the predicted-position ring, the Compare cross, the Ghost, the chips and legend) and zooms
// tight on the star, so a fast mover's hop between the first and last season is plain to see
// (Barnard's Star: about 1.8 of a 6.15″ pixel). Turning it off puts back exactly what was there:
// the same zoom and pan, and every overlay setting untouched (they are only skipped while on).
// ui.js owns the stage; this module only asks it to redraw.

export const CLEAN_ZOOM = 3;

// Drawing options with every overlay off (the image pixels and the stretch are untouched).
export const cleanOpt = (o) => ({ ...o, ring: false, hatch: false });

// Pan (CSS px) that puts grid point (mx, my) at the centre of an n-pixel canvas drawn at `cell`
// CSS px per pixel, clamped like the viewer's own drag pan.
export function centrePan(n, cell, mx, my) {
  const c = (n - 1) / 2, lim = n * cell / 2, cl = v => Math.max(-lim, Math.min(lim, v));
  return { panX: cl((c - mx) * cell), panY: cl((c - my) * cell) };
}

// ctx: { $, getView, setView, cell, target, redraw, mode, Snd }
//   getView() -> { zoom, panX, panY }; setView(v) applies it and lays the stage out;
//   cell() -> CSS px per image pixel after layout; target() -> [[x,y] first, [x,y] last] or null.
export function createCleanBlink(ctx) {
  const key = ctx.$('cleanKey'), stage = ctx.$('stage');
  const S = { on: false, saved: null };

  function sync() {
    key.setAttribute('aria-pressed', String(S.on));
    key.querySelector('.cb-l').textContent = S.on ? 'Clean blink: on' : 'Clean blink';
    stage.classList.toggle('clean-blink', S.on);
  }
  function on() {
    if (S.on || ctx.mode() !== 'blink') return;
    S.saved = ctx.getView(); S.on = true; sync();
    const t = ctx.target();
    ctx.setView({ zoom: CLEAN_ZOOM });
    if (t) {
      const mx = (t[0][0] + t[1][0]) / 2, my = (t[0][1] + t[1][1]) / 2;
      ctx.setView({ zoom: CLEAN_ZOOM, ...centrePan(ctx.n(), ctx.cell(), mx, my) });
    }
    ctx.redraw();
  }
  function off(restore = true) {
    if (!S.on) return;
    S.on = false; sync();
    if (restore && S.saved) ctx.setView(S.saved);
    S.saved = null;
    ctx.redraw();
  }
  key.addEventListener('click', () => { S.on ? off() : on(); ctx.Snd?.play('click'); });

  return {
    get on() { return S.on; },
    opt: (o) => (S.on ? cleanOpt(o) : o),
    // leaving Blink, loading another target: drop clean mode (the caller sets its own zoom)
    leave: () => off(false),
    on, off,
  };
}
