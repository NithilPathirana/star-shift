# Loader v1.1: the astronaut loop

Brought back by Nithil on Sat 14 Nov 2026 (~20:50): "Use the revamped astronaut – render it and get it done and give me v1.1."

**SI-generated (AI-generated).** Space Apps calls AI "Super Intelligence (SI)", so the marks use that word. The picture was modelled and rendered by Claude (Anthropic) in Blender 5.2 (Cycles) for team Proper Motion, NASA Space Apps 2026. Every video and still carries a small baked mark in the bottom-right corner, "Animation: SI-generated (made by Claude in Blender)", and the component always shows the caption "Animation: SI-generated (made by Claude in Blender) · Background: NASA SPHEREx all-sky map (IRSA)". The code is AI-written too.

The app crops the picture to fill the stage, so the baked corner mark is often outside the visible area there. The caption is the mark people see in the app; the baked one is for the files themselves.

No NASA or agency logos, insignia or lettering, no real spacecraft likeness, no face. Background: the real NASA SPHEREx all-sky map (IRSA DR1), shown through a navy-to-white colour scale (scene v4; the first scene used the app's copper image scale).

## Files

| File | Use |
|---|---|
| `astro-loader.js`, `astro-loader.css` | The component |
| `astronaut-loop-1080.webm` / `.mp4` | 8 s seamless loop, 1920×1080, 30 fps |
| `astronaut-loop-720.webm` / `.mp4` | 1280×720 for small screens and Save-Data |
| `astronaut-exit-1080.webm` / `.mp4`, `astronaut-exit-720.webm` / `.mp4` | 1.5 s exit clip |
| `astronaut-still-1080.webp`, `astronaut-still-720.webp`, `astronaut-still.png` | Poster and Reduce-motion picture |
| `preview.mp4` | Loop followed by the exit clip, for showing people. Not used by the app |
| `watermarked-assets.sha256` | The deploy gate's list: SHA-256 and name of the ten files the app loads, each checked for the baked SI-generated mark. If any of those files is re-encoded, re-check the mark (`python _build/mark_check.py` makes `_build/mark-check-sheet.png`) and update its hash; the deploy script refuses a mismatch |
| `_build/` | Blender script, `.blend`, raw frames, encode script. **The raw frames have no AI mark: never publish or serve this folder.** |

The videos are full-frame with their own sky, so they have no alpha channel. MP4 (H.264) is the Safari fallback.

## API (the same calls as `ScanLoader`)
```js
const L = AstroLoader(element, {
  target: "Barnard's Star",   // shown in "Finding images of …"
  total: 0,                   // planned image count (0 = unknown yet)
  reducedMotion: false,       // true = the still, no video
  startAfter: 8,              // "Start watching" appears after this many images
  base: '/loader/v1.1/',      // where the astronaut-* files are (default: the folder this script was loaded from)
  onStart() {}, onRetry() {}
});
L.set({ target, total, plan });   // late updates
L.add(frame);                     // one arrived image (only counted; pass the same object as for ScanLoader)
L.slow('IRSA is slow. …');        // retry pill, and the video pauses; L.slow(null) resumes
const ms = L.done();              // starts the exit; wait ms, then hide and destroy
L.destroy();
```
`done()` returns 1900 (exit clip + fade), 400 (clip not ready, or the whole load took under 4 s, as with cached data) or 0 (Reduce motion). `ScanLoader.done()` returns nothing, so `ms ?? 400` works for both.

`mode`, `bands` and `plan` are accepted and passed on to the fallback. If the still cannot load (media folder missing) and the page has `ScanLoader`, the component hands over to it and replays the images that already arrived.

## Exact embed for `web/` (matches `web/app/ui.js` and `server/server.mjs` as of Sat 14 Nov 20:50)

1. **Files.** Copy `astro-loader.js` to `web/app/` and `astro-loader.css` to `web/styles/`. The media stays in `design/loader/v1.1/` and is served in place.

2. **`server/server.mjs` line 60:** let `/loader/v1.1/` through. Sub-folders stay blocked, so `_build/` cannot be reached.
```js
if (!/^\/loader\/(v1\.1\/)?[\w.-]+\.(webm|mp4|webp|png)$/.test(rel)) { res.writeHead(404).end('Not found'); return; }
```
   Restart the server after this change.

3. **`web/index.html`:** after the scan-loader tags (keep those: the scan loader is the fallback)
```html
<link rel="stylesheet" href="styles/astro-loader.css?v=1">
```
```html
<script src="app/astro-loader.js?v=1"></script>
```

4. **`web/app/ui.js`:** replace the `LOADER_MODE` constant
```js
const LOADER = 'astronaut'; // 'astronaut' (Design v1.1) | 'scan' | 'sheet' (the code-based loader)
```
   and in `load()` replace `V.scan = window.ScanLoader($('scanLoader'), { mode: LOADER_MODE, …` with
```js
V.scan = (LOADER === 'astronaut' ? window.AstroLoader : window.ScanLoader)($('scanLoader'), {
  mode: LOADER, base: '/loader/v1.1/', target: V.name, bands: ranges, reducedMotion: set.motion,
  onStart: () => { Snd.play('click'); $('thin').hidden = false; leaveLoader(); if (!set.motion) P.play(); },
  onRetry: () => { Snd.play('click'); if (V.query) load(V.query, V.name); },
});
```

5. **`leaveLoader()`:** wait as long as the loader asks
```js
function leaveLoader() {
  const L = $('stLoading'); if (L.hidden || !V.scan) return;
  const scan = V.scan; V.scan = null; const ms = scan.done();
  setTimeout(() => { L.hidden = true; scan.destroy(); }, set.motion ? 0 : (ms ?? 400));
}
```

Nothing else changes: `set()`, `add()`, `slow()` and `destroy()` are called exactly as now.

## Changes
- **v4 (Sun 15 Nov 13:53), a new scene:** Nithil, "Improve the astronaut animations also", after choosing the blue, white and neon-yellow look. `_build/build_rocket_v4.py` (a changed copy of v3): white rocket and suit, blue bands, visor and gloves, navy trim, neon-yellow rings and exhaust, and the SPHEREx sky shown navy-to-white. **The rider waves once per loop** (camera-side arm up at 3.0 to 5.8 s; the poster still is the top of the wave), looks around more, the rocket rolls and sways about three times as much, there are three times as many dust motes moving two to five times faster (speed streaks), and the exhaust flickers and pulses more. Same length, size and frame rate (240 + 45 frames, 30 fps), so the component did not change. Rendered frames: `_build/frames_v4/`, `_build/frames_exit_v4/`. The loop seam was measured (frame 240 to 1 differs as much as any neighbouring pair). `python _build/encode.py` now encodes v4; `python _build/encode.py .. v3` encodes the first copper scene, whose frames are kept.
- **v3 (Sun 15 Nov), media and wording:** the baked mark now reads "Animation: SI-generated (made by Claude in Blender)" (was "AI-generated"), at the same place, size and contrast. All twelve media files were re-encoded by `_build/encode.py` from the same clean frames; nothing was re-rendered in Blender. `watermarked-assets.sha256` and `_build/mark-check-sheet.png` were remade. The caption in `astro-loader.js` says SI-generated too.
- **v2 (Sat 14 Nov 21:06), `astro-loader.js` only:** the exit clip is skipped when the whole load took under 4 s (was 1.2 s). On the live site a cached Barnard's Star load takes 1.7 s; the 1.9 s exit nearly doubled the wait. Recopy to `web/app/` and load with `?v=2`.
- **Optional, in `web/app/ui.js`:** playback starts while the exit clip still covers the stage (`P.play()` in `onStart` and in the `DONE` branch), so the first ~2 s of the flip-book are hidden. To fix, let `leaveLoader()` return the wait (`return set.motion ? 0 : (ms ?? 400);`, and `0` on its early return) and start playback after it: `setTimeout(() => { if (!set.motion && !P.playing) P.play(); }, leaveLoader());` in both places.

## Rebuilding
`_build/build_rocket_v4.py` (`blender -b --factory-startup -P build_rocket_v4.py -- full`, then `-- exit`; about 40 minutes on the Scar while other work runs) renders `frames_v4/` (240) and `frames_exit_v4/` (45); frames already on disk are kept. `python _build/encode.py` then writes the files above into this folder.

## Scene v6 (15 Nov 2026, 16:03 Sri Lanka time)
Asked for by Nithil: no Earth, deep space, far more detail on the rocket and the rider, a rider pose that reads as riding.
- Scene script: `_build/build_rocket_v6.py` (Blender 5.2, Cycles). Raw frames: `_build/frames_v6` (240) and `_build/frames_exit_v6` (45); never publish these, they carry no mark.
- Encode: `_build/encode.py` (no version argument = v6). The mark is now white on a dark pill, 22 px tall at 1080 and 15 px at 720, on every frame.
- Checked: 12 files match the old ones in codec, size and frame count; 42 decoded corners all show the mark (`_build/mark-check-sheet.png`); `watermarked-assets.sha256` rewritten and verified.

## Scene v7 (15 Nov 2026, 16:30 Sri Lanka time)
Asked for by Nithil: a real NASA spacesuit for the rider. Credit line (README and site credits): "Spacesuit model: NASA 3D Resources (public domain), modified".
- Model, source, hash, what was changed and NASA's rules: `../v5c/SOURCE.md`. Cleaning script: `../v5c/tools/emu_prep.py` (deletes every original material and texture, so no flag, patch or lettering can render; deletes the head).
- Loop: `_build/v7_from_blend.py` on the saved v6 scene (`rocket_v6.blend`, not in git). Exit clip: `_build/build_rocket_v7.py -- exit`. Encode: `python _build/encode.py <outdir> v7`. 1920 x 1080, 36 samples.
- The suit is not re-posed (the model has no skeleton): it stands in a hatch, cut off above the knee by the hull. No wave.
- Checked: 12 files match v6 in codec, size and frame count; 42 decoded corners all show the mark; hashes rewritten and verified; last loop frame joins the first.
- Never publish `../v5c/inspect/` (the model's original flag and patch textures) or `_build/frames_v7*` (no mark).
