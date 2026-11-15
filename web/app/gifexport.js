// "Save as GIF" / "Save as video" for the viewer's Blink, Time and Compare > Difference (spec-team-extras.md 3).
// Records the view on screen at its real (CSS) size, burns in the credit, the frame's own label and the SI line,
// keeps the file under 5 MB, and shows progress. GIF: our own encoder (gif.js); video: MediaRecorder WebM.
// Works offline: nothing here touches the network.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { buildPalette, indexFrame, encodeGif } from './gif.js';

export const MAX_BYTES = 5 * 1024 * 1024;
const BUDGET = MAX_BYTES - 64 * 1024; // a little headroom under 5 MB
const MAX_SIDE = 720; // a zoomed-in view is recorded at most this wide
export const SI_LINE = "Built with SI tools (Super Intelligence, NASA's term for AI)";
export const creditLine = (target, dates) => ['Star Shift', 'NASA SPHEREx data (IRSA)', target, dates].filter(Boolean).join(' · ');
export const fileName = (target, kind, ext) => `star-shift-${String(target || 'view').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${kind}.${ext}`;

// split text into lines that fit maxW (canvas measureText)
function wrap(g, text, maxW) {
  const out = []; let line = '';
  for (const w of String(text).split(' ')) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width <= maxW || !line) line = t; else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

// view(): null when the current view can't be saved, else
// { kind: 'blink'|'time'|'difference', target, dates, count, begin(), frame(k) -> Promise<{ canvas, label, delay(ms) }>, end() }
export function createGifExport({ $, toast, view, onDone }) {
  const gifKey = $('gifKey'), vidKey = $('vidKey'), prog = $('gifProg');
  const mime = typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype.captureStream
    ? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) : null;
  let busy = false;
  const tick = () => new Promise(r => setTimeout(r, 0));
  function status(txt, pct) {
    prog.hidden = !txt; prog.textContent = txt || '';
    for (const k of [gifKey, vidKey]) k.disabled = busy;
    const l = gifKey.querySelector('.gif-l'), lv = vidKey.querySelector('.gif-l');
    if (l) l.textContent = busy && pct != null && gifKey.dataset.run ? `GIF ${Math.round(pct)}%` : 'Save as GIF';
    if (lv) lv.textContent = busy && pct != null && vidKey.dataset.run ? `Video ${Math.round(pct)}%` : 'Save as video';
  }
  // which keys show: only on a view that can be saved (Blink, Time, Compare > Difference)
  function sync() {
    let v = busy; try { v = v || !!view(); } catch { /* the viewer is still starting */ }
    gifKey.style.display = v ? '' : 'none'; vidKey.style.display = v && mime ? '' : 'none';
  }

  // the frames of the current view, drawn with the caption under the image
  async function capture(v, scale, from, to) {
    const frames = [];
    v.begin();
    try {
      for (let k = 0; k < v.count; k++) {
        const { canvas, label, delay } = await v.frame(k);
        const cssW = parseFloat(canvas.style.width) || canvas.width, cssH = parseFloat(canvas.style.height) || canvas.height;
        const s = Math.min(1, MAX_SIDE / cssW) * scale, w = Math.max(2, Math.round(cssW * s)) & ~1, ih = Math.max(2, Math.round(cssH * s));
        const fs = Math.max(12, Math.round(w / 34)), lh = Math.round(fs * 1.35), pad = Math.round(fs * .7);
        const out = document.createElement('canvas'), g = out.getContext('2d');
        g.font = `${fs}px system-ui, sans-serif`;
        const credit = wrap(g, creditLine(v.target, v.dates), w - 2 * pad), lab = wrap(g, label || '', w - 2 * pad).slice(0, 2), si = wrap(g, SI_LINE, w - 2 * pad);
        const capH = pad * 2 + lh * (credit.length + 2 + si.length); // two lines kept for the frame label, so every frame is one size
        out.width = w; out.height = (ih + capH) & ~1 || 2;
        g.fillStyle = '#14110f'; g.fillRect(0, 0, out.width, out.height);
        g.imageSmoothingEnabled = false; g.drawImage(canvas, 0, 0, w, ih);
        g.textBaseline = 'top'; let y = ih + pad;
        g.font = `600 ${fs}px system-ui, sans-serif`; g.fillStyle = '#ffffff'; for (const t of credit) { g.fillText(t, pad, y); y += lh; }
        g.font = `${fs}px system-ui, sans-serif`; g.fillStyle = '#e8ff3a'; lab.forEach((t, i) => g.fillText(t, pad, y + i * lh)); y += 2 * lh;
        g.fillStyle = '#d9d4cf'; for (const t of si) { g.fillText(t, pad, y); y += lh; }
        frames.push({ w: out.width, h: out.height, px: g.getImageData(0, 0, out.width, out.height).data, delay, canvas: out });
        status(`Recording frame ${k + 1} of ${v.count}…`, from + (to - from) * (k + 1) / v.count);
        await tick();
      }
    } finally { v.end(); }
    return frames;
  }

  function save(blob, name) {
    gifKey._last = { size: blob.size, type: blob.type, name, blob }; // for the page check
    if (window.__ssNoDownload) return;
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  const mb = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

  async function makeGif() {
    const v = view(); if (!v || busy) return;
    busy = true; gifKey.dataset.run = '1'; status('Recording…', 0);
    try {
      let scale = 1, frames = await capture(v, scale, 0, 40), bytes = null;
      for (let tryN = 0; tryN < 6 && !bytes; tryN++) {
        const { w, h } = frames[0];
        const { palette, lookup } = buildPalette(frames.map(f => f.px));
        const idx = [];
        for (let k = 0; k < frames.length; k++) { idx.push({ indices: indexFrame(frames[k].px, lookup), delay: frames[k].delay / 10 }); status(`Encoding the GIF… ${k + 1} of ${frames.length}`, 40 + 55 * (k + 1) / frames.length); await tick(); }
        const out = encodeGif({ width: w, height: h, palette, frames: idx });
        if (out.length <= BUDGET) { bytes = out; break; }
        // too big: Time keeps every other image (each shown twice as long); otherwise record smaller
        if (frames.length > 6) frames = frames.filter((_, i) => i % 2 === 0).map(f => ({ ...f, delay: f.delay * 2 }));
        else { scale *= Math.sqrt(BUDGET / out.length) * .9; frames = await capture(v, scale, 0, 40); }
      }
      if (!bytes) throw new Error('could not fit the GIF under 5 MB');
      const blob = new Blob([bytes], { type: 'image/gif' }), name = fileName(v.target, v.kind, 'gif');
      save(blob, name); status('', 100);
      toast(`Saved ${name} (${mb(blob.size)}, ${frames.length} frame${frames.length === 1 ? '' : 's'})`); onDone?.('gif');
    } catch (err) { console.warn('gif export', err); status(''); toast(`Couldn't save the GIF: ${err.message}`); }
    finally { busy = false; delete gifKey.dataset.run; status(''); sync(); }
  }

  async function makeVideo() {
    const v = view(); if (!v || busy || !mime) return;
    busy = true; vidKey.dataset.run = '1'; status('Recording…', 0);
    try {
      const frames = await capture(v, 1, 0, 30), { w, h } = frames[0];
      // Blink flips 4 times round; a still (Difference) holds 3 s; Time plays once, at most 20 s
      const seq = v.kind === 'blink' ? [].concat(...Array(4).fill(frames)) : frames.length === 1 ? [{ ...frames[0], delay: 3000 }] : frames;
      let total = seq.reduce((s, f) => s + f.delay, 0);
      if (total > 20000) { const k = 20000 / total; seq.forEach((f, i) => { seq[i] = { ...f, delay: f.delay * k }; }); total = 20000; }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
      g.drawImage(seq[0].canvas, 0, 0);
      const stream = cv.captureStream(30), chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.min(4e6, Math.floor(BUDGET * 8 * .8 / (total / 1000 + 1))) });
      rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      const stopped = new Promise(r => { rec.onstop = r; });
      rec.start(250);
      const t0 = performance.now(); let at = 0;
      for (const f of seq) {
        g.drawImage(f.canvas, 0, 0); const end = at + f.delay;
        while (performance.now() - t0 < end) { // repaint so the stream keeps sending frames on a long hold
          await new Promise(r => setTimeout(r, Math.min(100, Math.max(5, end - (performance.now() - t0)))));
          g.drawImage(f.canvas, 0, 0);
          status('Recording the video…', 30 + 68 * Math.min(1, (performance.now() - t0) / total));
        }
        at = end;
      }
      rec.stop(); stream.getTracks().forEach(t => t.stop()); await stopped;
      const blob = new Blob(chunks, { type: 'video/webm' }), name = fileName(v.target, v.kind, 'webm');
      if (!blob.size) throw new Error('the browser recorded nothing');
      if (blob.size > MAX_BYTES) throw new Error(`the video came out at ${mb(blob.size)}, over 5 MB`);
      save(blob, name); toast(`Saved ${name} (${mb(blob.size)})`); onDone?.('video');
    } catch (err) { console.warn('video export', err); toast(`Couldn't save the video: ${err.message}`); }
    finally { busy = false; delete vidKey.dataset.run; status(''); sync(); }
  }

  gifKey.addEventListener('click', makeGif);
  vidKey.addEventListener('click', makeVideo);
  return { sync, makeGif, makeVideo, busy: () => busy, videoType: mime };
}
