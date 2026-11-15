# Work order 5: "Design v1", the whole app as Coding actually built it (Sat 14 Nov ~18:20)

From: UI/UX chat session. To: Space Apps – Design Studio (Fable). Nithil's request (via Master, ~17:30). Same direction E, materials, motion, Clarity and DON'Ts as `work-order-3.md`. The rocket 3D/Blender job was sent to you directly by the Master; it's listed in section 5 only so everything is in one place.

## 0. Goal and deliverables
Nithil wants **one complete, consistent "Design v1" covering the whole app as built**, so Coding can restyle the real site from it. That means designing the parts Coding has actually built (names, controls and options as they exist), not the parts we imagined in E/E+. Wherever E+ and the real build differ, **the build wins on what exists; E wins on how it looks.**
1. `C:\SpaceApps2026\design\DESIGN.md` → **v3 = "Design v1"**. Map every real element and control (inventory in section 2) to an E component, token and state. Add a short "Build mapping" table: real element/ID/class in `web\` → E component → notes. Read `web\index.html`, `web\styles\app.css`, `web\styles\tokens.css` and `web\app\*.js` for the real IDs and classes.
2. `C:\SpaceApps2026\design\mockups\design-v1.html`: a prototype laid out exactly like the real app (same panels and controls), styled in E. Reuse the data assets.
3. Screenshots in `shots\design-v1-*.png` at 1366×768, 1920×1080 and 390×844. Cover: the sky map, the time-lapse playing, the band editor open, the loading (rocket) state, and the phone layout.
4. Message me the paths. I show Kurucharan and tell the Master and Coding.

## 1. Run the real site first
It's already running at **http://127.0.0.1:8787** (double-click `C:\SpaceApps2026\start.vbs` if not). Look at every part: search `Barnard's Star`, the Sky map tab, the Time-lapse tab, play, scrub, Season stacks, every Display option, the Colour bands panel (add, edit, delete, reset), More detail, Copy link and the footer. Check 1366×768 and phone width.

## 2. What is built (I checked at ~18:15)
- **Header:** title text (currently "SPHEREx Time Viewer"; the name is the team's, keep it as text in the tool-name slot plus Kurucharan's logo slot) · search "Star name or RA Dec, e.g. Barnard's Star or 269.45 +4.69" + **Show** · an error line under the search · **Try:** chips for the 5 targets.
- **Mode tabs:** **Sky map | Time-lapse**.
- **Sky map** (Aladin Lite 3.8.2 with the real SPHEREx all-sky DR1 HiPS):
  - wavelength label ("Wavelength: 1.63 µm", one of 102 colours at a time);
  - help text (drag to pan, scroll/pinch to zoom, click a spot for details, hover a marked object for its name);
  - centre reticle and a **"Watch the centre over time"** button, which leads to the time-lapse.
  - The real map has survey tiles, so drop E+'s placeholder note.
- **Time-lapse:**
  - **Image:** real frames, now wider (FOV 3′/10′/20′, default 10′, smooth or true pixels). It has an N/E compass, a scale bar ("1′") and a red crosshair at the predicted position.
  - **Player:** prev / play-pause / next; date + time ("1 Oct 2025, 06:23 UTC"), "Frame 40 of 120"; an fps menu (1/2/4/8); a plain scrubber with start/end dates; **Single frames | Season stacks**; a keys hint; and the status "Downloading frames: 105 of 120" → "120 frames loaded".
  - Design the scrubber as E's **season-segment scrubber** ("Season 1 of 3": Aug–Oct 2025 / Mar–May 2026 / Aug–Sep 2026). Nithil refers to it that way, and Coding should build it.
  - **Compare/Blink from E is NOT built** (Season stacks is the nearest thing). Show it in the design marked "proposal". Don't drop it silently, don't present it as built.
- **"This spot" panel** = the Coordinate details panel:
  - Target, Position, Motion ("10.39″ per year (1.69 SPHEREx pixels)"), Measured here ("9.87 ± 0.61″ per year (SPHEREx, 105 frames)"), Speed across sky ("90.1 km/s (SIMBAD…) · 86 km/s from SPHEREx"), Radial velocity ("−110.1 km/s (SIMBAD: coming towards us)"), SPHEREx images (count + date span);
  - "This frame": Taken / Wavelength / Detector; "More detail".
  - Galactic/ecliptic, constellation, nearby objects and **observer location** (alt/az, rise/set, opt-in + privacy line) are in the team list but I didn't see them built yet. Design them in the panel per E+ §13/§16; Coding adds them.
  - Use E's OBSERVED / COMPUTED / CATALOGUE tags (here: SIMBAD = CATALOGUE, SPHEREx measured = OBSERVED/MEASURED, derived = COMPUTED).
- **Colour bands panel:** "Show the map in my colour bands" checkbox; explanation text; a list of bands (name, range, number of colours, detectors) with Edit / Delete; an Add-a-band form (Name, From µm, To µm, Colour); Reset to defaults. Restyle it as E+'s ruler editor and **keep the list** (it's accessible and already built).
- **Display panel:** Field of view 3′/10′/20′ · Wavelength band (All / Band 1–6) · Brightness scale Linear/Asinh/Log · Pixels Smooth/True pixels · Frames to load 60/120/All · **Copy link to this view**. In E these belong in the Clarity/Image popover or a "Display" glass sheet. Don't lose any option.
- **Footer credits:** IRSA DOIs, SIMBAD, Gaia DR3, "All code on this site was written by an AI model (Claude, by Anthropic)… Not an official NASA site." Keep it, styled quietly. Add "UI sounds synthesised by AI-written code".

## 3. Nithil's default colour bands (decided, use them exactly)
| # | Name | Range (µm) | Colour |
|---|---|---|---|
| 1 | Starlight | 0.74–1.11 | #5B8CFF |
| 2 | Cool Stars | 1.11–1.64 | #3FC1C9 |
| 3 | Through the Dust | 1.64–2.42 | #7BD389 |
| 4 | Water Ice | 2.42–3.82 | #F2C14E |
| 5 | CO₂ Ice | 3.82–4.42 | #F28C38 |
| 6 | Brown Dwarfs | 4.42–5.01 | #E5484D |

These are **data colours**, so the blue/cyan in them is fine. Kurucharan's "no blue/cyan" rule is about the UI chrome, which stays ivory/copper/sage. Rules:
- band colours appear only on data: swatches, ruler bands, timeline ticks, the wavelength chip dot, map tint;
- never as UI text colour on ivory (contrast). The band name is always written next to its swatch.

The ruler shows 0.74–5.01 µm (settled by the Master).

## 4. Sound changes (Nithil)
- **Change the scroll/zoom sound** (the map/stage zoom). Make it clearly different from the current one: e.g. a very soft, short filtered "air" whoosh or a gentle pitch glide (up for zoom in, down for zoom out), throttled to at most one every ~150 ms during continuous scroll.
- **New scrubber sounds:**
  - a soft tick per frame while scrubbing, quieter than the button click and rate-limited so fast drags don't buzz;
  - a **distinct season-crossing cue** (e.g. a two-note chime or a lower "detent thunk") when the thumb crosses into a new season segment.
  - No per-frame tick during normal playback (only when the user drags or steps). The season cue may play softly during playback; your call, keep it subtle.
- Keep the mute toggle (Clarity → Sound) and respect the OS/user settings (reduced motion → sound default off).
- Credits/README: "UI sounds synthesised by AI-written code (Web Audio)".
- Document every sound in DESIGN.md: event, synthesis recipe (wave, frequencies, envelope, gain), throttle, and when it's muted.

## 5. Rocket loading animation (Master already briefed you; repeated here)
A 3D animation made in **Blender** by you (Fable 5.2): a person riding a rocket, generic cartoon character, **no NASA or any agency insignia**, no real spacecraft likeness. It **carries a small visible "AI-generated" watermark** in the rendered frames. Render to a web-friendly format (WebM with alpha, or a PNG sequence/sprite, plus a still for reduced motion). It always sits next to **real progress** ("Downloading frames: 105 of 120"); it never replaces it or fakes it. Specify in DESIGN.md how Coding embeds it.

## 6. Things I noticed on the real site (for Coding, FYI; don't fix code)
- In my browser pane the Sky map stayed **blank**, and the search showed "recursive use of an object detected which would lead to unsafe aliasing in rust" (an Aladin Lite WASM error) after searching Barnard's Star. Time-lapse worked. I'm reporting it to Coding separately. Your design should include a **map-failed state** ("Sky map couldn't load. Time-lapse still works → [Open time-lapse]").
- The error appears as red text under the search box. In E it should be a proper inline error message with a recovery action.

## 7. Same rules as before
His DON'Ts list (work-order-3 §7), no NASA/SPHEREx logos, insignia or spacecraft art, AI images watermarked, no under-18 photos, and no features beyond the team list (mark anything unbuilt as "proposal").
