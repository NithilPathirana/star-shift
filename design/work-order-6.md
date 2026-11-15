# Work order 6: Rocket loader v2, a full-screen, realistic 3D animation (Kurucharan, Sat ~19:00)

From: UI/UX chat session. To: Space Apps – Design Studio (Fable). This replaces the loader in `design\loader\` (v1). Keep v1's files; put v2 in `design\loader\v2\`.

## Kurucharan's feedback on v1 (his words, lightly tidied)
"Not like this, make it natural. Don't make it a loading bar but an animation. It shouldn't travel along the bar. It should travel in a 3D space. Also, get rid of the ugly AI-generated part and include that in small text at the bottom instead. Make the entire screen the animation. Improve the Blender image: it is way too simple and very bad. It has no shadows, doesn't look realistic in the slightest, and just overall looks very bad."

## What to make
1. **The whole screen is the animation.** While the app loads, the stage (or the whole viewport on first load) is a full-bleed 3D scene, not a small sprite on a bar. No progress bar for the rocket to ride.
2. **It travels through 3D space, naturally.** The rocket flies *through* the scene and the camera moves with it:
   - **Path:** a gentle curving route with banking into turns, slight yaw/pitch drift, and parallax between near and far elements.
   - **Camera:** a cinematic follow (slight lag and ease, a soft handheld float, never jerky).
   - **Rider:** reacts naturally (leans into turns, head turns toward the camera, a small wave once per loop, no robotic flailing).
   - **Motion quality:** real easing everywhere (no linear keyframes), secondary motion (scarf cloth sim or a well-keyed follow-through), engine flame flicker with noise.
   - **Loop:** seamless, 6–8 s (longer than v1, so the loop isn't obvious).
3. **Realistic rendering, much better than v1:**
   - **Engine:** Cycles on the GPU (the RTX 5090 is fast; use it). No Workbench/flat look.
   - **Lighting:** a proper rig: a key light (warm, top-left, matching the UI's light), a cool rim/back light to separate the silhouette, and an HDRI or world lighting for reflections. **Real shadows and contact shadows/ambient occlusion**, and the rider casts a shadow onto the rocket.
   - **Materials (PBR):**
     - rocket hull: ivory painted metal with clear-coat, subtle panel lines, rivets, a little wear, edge highlights;
     - copper nose/fins: brushed/anodised copper with anisotropic highlights;
     - visor: dark reflective glass that shows the environment;
     - suit: fabric with sage colour, soft folds and stitching detail.
   - **Modelling:** bevelled edges everywhere (no hard CG edges), proportions with character, more detail (panel seams, a porthole with depth, fin roots, nozzle with heat discoloration), and a suit with a backpack, gloves and boots. The character is still generic (no real person's likeness) with **no NASA or any agency insignia and no real spacecraft likeness**.
   - **Engine flame:** a volumetric or emission shader with heat haze, plus faint light cast from the flame onto the hull.
   - **Camera effects:** motion blur, gentle depth of field, slight bloom on the flame, film-like tone mapping (AgX), a subtle vignette.
4. **The environment (honest and beautiful):**
   - **Preferred:** use the **real SPHEREx all-sky map** as the distant background (an equirectangular image made from the IRSA SPHEREx HiPS, e.g. via hips2fits or the HiPS tiles Coding already uses), mapped onto a world sphere. The rocket flies through *our actual data's sky*. Credit "Background: NASA SPHEREx all-sky map (IRSA)" in the small caption.
   - If that isn't feasible in time: a dark warm deep-space void with soft volumetric light shafts and a few out-of-focus bokeh lights that are clearly decorative.
   - Don't invent a fake detailed galaxy or nebula pretending to be data.
   - Mid-ground parallax elements are welcome (soft dust motes passing the camera, a distant ringed planet silhouette), but keep them subtle and in the palette (warm graphite, copper light, sage reflections).
5. **AI label: small text at the bottom, not a big badge.**
   - Remove the large "AI-generated" box burned into the frames.
   - Instead, put a **small but clearly readable caption at the bottom** of the loading screen, e.g. bottom-left: "Animation: AI-generated (made by Claude in Blender)". It must sit on top of the animation (so it's part of the visible picture) at ≥11 px with good contrast (light text on a soft dark scrim), so it still counts as the **visible watermark** the competition requires.
   - Also bake a very small, low-opacity "AI-generated" mark into a corner of the rendered frames. Then any screenshot or screen recording, e.g. in Dehan's demo video, still carries it, even if the HTML caption is cropped.
6. **Real progress, kept but quiet.** The team rule still holds: IRSA is slow, so honest progress must stay visible. The rocket no longer rides a bar, so instead show:
   - a small text line near the bottom centre, over the animation: "Finding images of Barnard's Star · 12 of 60 loaded";
   - optionally a hairline thin progress line at the very bottom edge;
   - the Slow/retry state as a small glass pill ("IRSA is slow, trying again in 4 s · Retry now");
   - the "play as soon as a few arrive" rule: once ~8 frames are in, a copper "Start watching" button fades in over the animation.
7. **Exit:** when loading finishes (or the user presses Start watching), the animation cross-fades/zooms smoothly into the viewer (≤400 ms, spring easing). The rocket can fly off into the distance as the viewer fades in, if you can make that part of the loop's exit.
8. **Accessibility/performance:**
   - Reduced motion: one beautiful still frame (rendered at full quality) + the same text progress.
   - Sound: none during the loop; only the soft "loaded" confirm at the end.
   - Files:
     - full-bleed WebM (VP9/AV1, 1920×1080, ~6–8 s, ≤3 MB) + an MP4 (H.264) fallback for Safari;
     - a 1280×720 version for phones/low bandwidth, chosen by `media`/`srcset`-style logic;
     - poster/still images (webp + png).
   - The video is muted, autoplay, loop, playsinline; `object-fit: cover`, so it fills any window size (works with the fluid layout).
9. **Deliverables:**
   - `design\loader\v2\` with the renders, the .blend, the build script and README.md;
   - updates to `direction-e-features.html` Mock → Load/Slow (and design-v1.html if it already exists);
   - screenshots `shots\loader-v2-*.png` at 1366, 1920 and 390;
   - DESIGN.md §17 updated.
   - Then message me the paths. I'll show Kurucharan before anything goes to Coding.

## Priority
Do this alongside work order 5 (Design v1). If you have to choose, finish the Design v1 DESIGN.md mapping first (Coding is waiting on it), then the loader. Rendering can run in the background while you write.
