// Turn a frame (float pixel values) into a picture on a canvas.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.

// Display only: blank pixels (masked, or saturated star cores the pipeline left empty)
// take the brightest neighbour, so bright stars don't show a black hole.
export function fillHoles(data, n, passes = 6) {
  const a = Float32Array.from(data);
  for (let p = 0; p < passes; p++) {
    let changed = 0;
    const src = Float32Array.from(a);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (Number.isFinite(src[k])) continue;
      let best = -Infinity;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const x = i + di, y = j + dj;
        if ((di || dj) && x >= 0 && y >= 0 && x < n && y < n && src[y * n + x] > best) best = src[y * n + x];
      }
      if (best > -Infinity) { a[k] = best; changed++; }
    }
    if (!changed) break;
  }
  return a;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

// Map values to 0..255 with the chosen brightness scale. Each frame is scaled on its own
// (frames are at different wavelengths, so a shared scale would make most of them black).
export function stretchToBytes(data, how = 'asinh', lo = 1, hi = 99.8) {
  const finite = Array.from(data).filter(Number.isFinite).sort((a, b) => a - b);
  const vlo = percentile(finite, lo), vhi = percentile(finite, hi);
  const span = vhi - vlo || 1;
  const out = new Uint8ClampedArray(data.length);
  const k = 12, ka = Math.asinh(k), kl = Math.log10(301);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) { out[i] = 0; continue; }
    let x = (v - vlo) / span;
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    if (how === 'asinh') x = Math.asinh(k * x) / ka;
    else if (how === 'log') x = Math.log10(1 + 300 * x) / kl;
    out[i] = Math.round(x * 255);
  }
  return out;
}

const scratch = typeof document !== 'undefined' ? document.createElement('canvas') : null;

// Draw `frame` to `canvas` (which fills its CSS box). settings: { stretch, pixels }.
export function drawFrame(canvas, frame, settings, { marker = true } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  const size = Math.round(canvas.clientWidth * dpr);
  if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size; }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  if (!frame) return;
  const n = frame.n;
  const bytes = stretchToBytes(fillHoles(frame.data, n), settings.stretch);
  scratch.width = n; scratch.height = n;
  const sctx = scratch.getContext('2d');
  const img = sctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) { const b = bytes[i]; img.data[i * 4] = b; img.data[i * 4 + 1] = b; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = settings.pixels !== 'true';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(scratch, 0, 0, size, size);
  if (marker && frame.expected) {
    // two short ticks pointing at the predicted position (they never cover the star)
    const s = size / n;
    const x = (frame.expected[0] + 0.5) * s, y = (frame.expected[1] + 0.5) * s;
    const gap = Math.max(14 * dpr, 3 * s), len = Math.max(14 * dpr, 2.5 * s);
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--color-marker').trim() || '#ff6b5e';
    ctx.lineWidth = 2 * dpr;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + len, y);
    ctx.moveTo(x, y - gap); ctx.lineTo(x, y - gap - len);
    ctx.stroke();
  }
}
