# Work order 6b: "The Spectrum Run", the hero 3D loader. This is part of Design v1. (Kurucharan, Sat ~19:30)

From: UI/UX chat session. To: Space Apps – Design Studio (Fable 5.2).
**This upgrades work order 6 and makes the loader part of Design v1** (DESIGN.md §17 + `design-v1.html`). Everything in WO6 still applies (full screen, small AI caption, real progress as quiet text, reduced-motion still, formats). This file raises the creative bar.

## Kurucharan's words
"This rocket redesign must be included in the v1 design. It is way too simple. It shouldn't travel in a line. Make Fable 5.2 show its colours and design something amazing. I have seen amazing 3D designs on Instagram… done by Fable 5.2. This must be equally impressive."

So: v1 and v1.5 read as a placeholder. He wants the kind of 3D piece people stop scrolling for: a crafted, art-directed, cinematic loop. Treat it as **your portfolio piece**. You have Blender 5.2, Cycles and an RTX 5090. Use them.

---

## 1. The concept: "The Spectrum Run"
A small astronaut on a beautifully made ivory-and-copper rocket **carves through six ribbons of infrared light**, one for each of the team's colour bands, against the real SPHEREx sky.
- The six ribbons are Nithil's bands, in spectral order:
  - Starlight #5B8CFF
  - Cool Stars #3FC1C9
  - Through the Dust #7BD389
  - Water Ice #F2C14E
  - CO₂ Ice #F28C38
  - Brown Dwarfs #E5484D

  They are huge, soft, volumetric, semi-transparent sheets of light: like aurora curtains or a spectrum fanned out by a prism, gently undulating and lit from within.
- The rocket doesn't travel in a line. It **weaves**: dives under the first ribbon, banks hard through the second, barrel-rolls through the third, corkscrews up and over, skims the surface of one (its wake ripples it), then arcs back around into the start position for a seamless loop.
- Each time it passes through a ribbon, **the ribbon's colour washes over the rocket and rider**. The ivory hull catches blue, then teal, then green, gold, orange, red, so the whole spectrum literally travels across the model. This is the "show its colours" moment: real light interaction, colour spill, reflections in the visor and the copper.
- It ties the loader to the product's story (we look at the sky across infrared colours) without any text or explanation. **Design motif only: no claims about real science in the animation.**

## 2. Storyboard (8 s seamless loop at 30 fps = 240 frames; adjust if it plays better at 10 s)
| Time | Shot / action | Camera |
|---|---|---|
| 0.0–1.2 s | The rocket enters from frame-left, low, under the **Starlight** (blue) ribbon. Blue light slides along the hull. | Low 3/4 front, 35 mm, slow push-in |
| 1.2–2.6 s | Banks right and cuts through **Cool Stars** (teal); the ribbon parts around it, then the wake ripple closes behind. The rider leans into the turn. | Camera swings around the rocket (slow orbit, ~40°) |
| 2.6–4.0 s | A full **barrel roll** through **Through the Dust** (green); the scarf whips with follow-through. | Side tracking shot, 50 mm, slight Dutch angle settling level |
| 4.0–5.4 s | Corkscrews up through **Water Ice** (gold), the brightest moment. Flame bloom, gold reflections across the visor; the rider gives a small wave toward the camera (once). | Camera drops below, looking up past the flame; DoF racks to the rider |
| 5.4–6.8 s | Skims along the surface of **CO₂ Ice** (orange): the hull grazes the light, leaving a glowing wake trail on the ribbon. | High 3/4, slow pull-back reveals all six ribbons as a fanned spectrum |
| 6.8–8.0 s | Arcs through **Brown Dwarfs** (red) and loops back around into the opening pose and position. | Camera eases back to the opening framing (**match the first frame exactly**) |
- **Seamless loop:** frame 240 = frame 0 in position, rotation, camera, ribbon phase (use cyclic noise / looping drivers), flame noise and cloth (bake the cloth with a pre-roll and pick a loop window, or key the scarf by hand with cyclic F-curves).
- **The exit/hand-off** (separate 1.5 s clip, `loader-exit.webm`): the rocket punches toward the camera, the flame bloom fills the frame warm-white, then cut/cross-fade into the viewer. Used when loading finishes or on "Start watching".

## 3. Art direction: look and feel
- **Style:** premium stylised realism, the "designer collectible" look that does well on Instagram 3D. Chunky, appealing proportions; rich, physically accurate materials and lighting; nothing plastic-cheap, nothing cartoon-flat, no uncanny human realism.
- **Palette:** the UI's warm ivory, copper and sage on the hardware. All saturated colour comes from the six ribbons. The space around is deep warm graphite to near-black, never navy, never purple.
- **The rocket ("instrument-grade"):**
  - **Shape:** a sleek, slightly retro-futurist teardrop body, about 6× rider height. Three swept fins with copper leading edges. A copper nose cone with a fine machined ring at its base, and a rear nozzle bell with heat-tinted blue/gold titanium discoloration.
  - **Surface:** ivory ceramic/enamel hull with clear-coat, fine panel grooves, flush rivets, a sage porthole with real glass depth and a soft interior glow, tiny scuffs and edge wear on high-contact areas, and **one abstract copper pinstripe**.
  - **Forbidden:** any lettering, flags, numbers, agency logos or real spacecraft likeness.
  - **Modelling:** bevel every edge (weighted normals; shade-auto-smooth with harden normals), so highlights roll smoothly.
- **The rider:**
  - A generic, faceless astronaut, small and chunky: a rounded helmet with a **gold-tinted reflective visor** (no visible face), sage fabric suit with soft folds and quilted panels, copper wrist rings, chunky boots and gloves, and a small backpack.
  - Sits astride the rocket, one hand on a copper grab-handle.
  - Personality through posture: leans into turns, looks toward the camera at the gold beat.
  - The scarf is copper-orange knit, simulated or carefully hand-keyed.
- **The ribbons:**
  - Volumetric emission in a thin, wavy volume, or layered transparent sheets with a noise-driven emission gradient. Brighter edges, soft falloff and subtle internal filaments (noise-textured).
  - Each emits real light onto the rocket: use light-emitting geometry, or add matching coloured area lights travelling with each crossing.
  - Animate a slow undulation with looping noise.
  - When the rocket passes through, a ripple propagates outward (shape key or displacement driven by the rocket's distance).
- **The environment:**
  - **Preferred:** the **real SPHEREx all-sky map** (from the IRSA SPHEREx HiPS, e.g. hips2fits as an equirectangular or a CAR projection) as the world background, kept dim (~10–20%) and warm-graded so it reads as a subtle, honest sky texture behind the action.
  - Credit it in the caption: "Background: NASA SPHEREx all-sky map (IRSA)".
  - If that can't be done in time, a deep graphite void with very faint dust and a few out-of-focus bokeh points, clearly decorative. **No invented galaxies or nebulae.**
  - Foreground: sparse dust motes drifting past the lens (depth-of-field blurred) for parallax and speed.

## 4. Lighting (the difference between "basic" and "amazing")
- **Key light:** warm (3800–4200 K) large area light from the top-left, matching the UI's light direction; soft but defined shadows.
- **Rim/back light:** cooler, slightly brighter, from behind-right, carving a crisp silhouette edge on the helmet, fins and scarf.
- **Practicals:**
  - the six ribbons (moving colour spill as the rocket passes through);
  - the engine flame (warm flickering point/area light on the fins and the rider's back);
  - the porthole glow.
- **World:** a dim neutral HDRI for reflections only; low strength, so black stays black.
- **Shadows:**
  - the rider casts onto the hull;
  - the fins cast onto the body;
  - contact shadows where the gloves meet the handle;
  - AO from Cycles' real GI (no fake AO pass needed).
- Expose so the ivory never clips; the brightest moments are the flame and the gold ribbon.

## 5. Animation quality
- Animate along a **curve with banking**: Follow Path with "Follow curve" + manual bank keys, or keys on an empty with an F-curve smoothness pass. **No linear interpolation anywhere.**
- Overlap and follow-through:
  - the rider lags slightly behind the rocket's turns;
  - the helmet settles after the roll;
  - the scarf trails;
  - the backpack straps jiggle subtly.
- Flame: a noise-driven length/brightness flicker plus a heat-haze refraction plane behind the nozzle.
- Camera: its own smoothed path with ~4–6 frames of lag behind the rocket, a slight handheld float (low-amplitude noise modifier), focal-length moves only at the beats listed, and **DoF focus tracking the rider's helmet**.
- Speed reads through motion blur, ribbon ripples, dust parallax and occasional light-streak trails from the flame (subtle).

## 6. Render settings
- **Engine:** Cycles, OptiX on the RTX 5090. 1920×1080 at 30 fps. 128–256 samples with adaptive sampling and OpenImageDenoise (or OptiX). Light paths high enough for volumes and glass (transmission 12+, volume bounces 2+).
- **Look:**
  - motion blur on (shutter 0.5);
  - DoF on (f/2.8–4 equivalent);
  - **AgX** view transform with the Medium-High Contrast look;
  - a slight bloom/glare in the compositor (Fog Glow on the flame and ribbon edges only);
  - a subtle vignette;
  - film grain at a very low level, to avoid banding in the dark gradients.
- Render the **lookdev stills first** (section 7), then the full sequence in the background (240 frames should take well under an hour on this GPU; check the per-frame time first). Use the persistent data option.
- **Outputs** to `design\loader\v2\`:
  - `rocket-loop-1080.webm` (VP9 or AV1, CRF tuned for ≤3–4 MB);
  - `rocket-loop-1080.mp4` (H.264, Safari fallback);
  - `rocket-loop-720.webm` (phones / slow links);
  - `rocket-exit.webm` + `rocket-exit.mp4`;
  - `rocket-hero-still.webp` + `.png` (the best single frame: the gold-ribbon moment, for reduced motion and as the video poster);
  - `rocket.blend`, `build_rocket_v2.py`, `README.md`.
- **The AI watermark** (competition rule: AI video needs a *visible* watermark):
  - a small, low-opacity "AI-generated" mark baked into the bottom-right corner of every rendered frame (~1.2% of frame height, 35–45% opacity, in a clean sans);
  - **plus** the HTML caption at the bottom-left of the loading screen: "Animation: AI-generated (made by Claude in Blender)" (and "Background: NASA SPHEREx all-sky map (IRSA)" if used).
  - The big badge from v1 is gone, as he asked.

## 7. Process: look-dev, self-critique, iterate (do not skip)
1. Build the rocket, rider and ribbons, then render **3 lookdev stills** at full quality: (a) the gold-ribbon beauty shot, (b) the side barrel-roll frame, (c) the wide pull-back with all six ribbons.
2. **Critique each still against this checklist** and fix before animating:
   - Does it look like a premium piece I'd post, not a default-material Blender scene?
   - Real shadows, contact shadows, rim light, no clipped whites, deep blacks?
   - Is the colour spill from the ribbons clearly visible on the hull, visor and copper?
   - Are the materials readable: enamel vs copper vs fabric vs glass?
   - Is the silhouette clear at a small size (think 390 px phone width)?
   - Is it free of insignia, text, real spacecraft likeness and faces?
   - Is it tasteful: not neon, not sci-fi-gamer, not purple/blue AI-slop?
3. Render a low-sample **animation preview** (e.g. 25% resolution, 16 samples). Check the motion: no linear moves, the loop is invisible, the banking feels natural and the camera never jerks.
4. Final render. Watch the encoded WebM full-screen at 1366×768 and 1920×1080 before reporting.
5. Save the 3 lookdev stills + 6 frames from the final (one per ribbon) to `shots\loader-v2-*.png` so I can show Kurucharan.

## 8. In the app (Design v1)
- The loading state is **full-bleed**: the video covers the whole stage on searches, and the whole viewport on the very first load, with `object-fit: cover`, muted, autoplay, loop, playsinline.
- Over it, quiet UI only:
  - bottom-centre text progress ("Finding images of Barnard's Star · 12 of 60 loaded");
  - an optional hairline at the very bottom edge;
  - the Slow/retry glass pill;
  - after ~8 frames, a copper **"Start watching"** button fades in;
  - the bottom-left caption with the AI note (and the SPHEREx background credit).
- Exit: play `rocket-exit` (or a 300 ms flame-bloom cross-fade) into the viewer.
- Reduced motion: the hero still + the same text.
- Sound: none during the loop; the soft "loaded" confirm at the end.
- Update `design-v1.html` (Mock → Load / Slow), `direction-e-features.html` and **DESIGN.md §17** (with an embed snippet for Coding).

## 9. Hard rules (unchanged)
- No NASA/SPHEREx/agency logos, insignia, flags, lettering or real spacecraft likeness.
- The character is generic and faceless (under-18 likeness rule).
- AI watermark visible as described.
- Real progress always shown.
- No fake science.

Report to me with the stills first if the full render will take long. I want to show Kurucharan the lookdev as soon as it exists.
