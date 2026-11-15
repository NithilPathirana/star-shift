# DESIGN.md: Star Shift viewer, direction E "Tactile glass instrument"

Status: **v3.3 = "Design v1.1" + team features 2 and 3 (sections 23–35), Sat 14 Nov 2026**, written by the Design Studio session. v1.1 = Design v1 with the astronaut loading screen (section 17). v2 added the team's 6 features (sections 12–17). v3 covers the whole app as built: 3D sky, visible cursor motion, sounds v2, errors, build mapping (sections 18–22).
Chosen by Kurucharan (team designer): D1, then pushed to E.

**Reference builds:** `design/mockups/direction-e.html` (core viewer) and `design/mockups/direction-e-features.html` (core viewer plus the team's 6 features, map-first). Copy values from those files when in doubt; this document explains them.
Shared helpers are in `design/mockups/assets/render.js` (stretch, colour scales, hatching, ring, season grouping, date and coordinate formatting). Coding may lift it as-is.

Scope: the core viewer only:
- search;
- image stage;
- playback with the season timeline;
- Time / Compare / Blink views;
- information panel with Observed / Computed tags;
- loading, error and empty states;
- Clarity panel.

No other workspaces. Features belong to the team (SI rule).

---

## 0. Brand: Star Shift

Given by Nithil on Sat 14 Nov 2026 (21:13): the name is **Star Shift** and the logo is the symbol below. Files are in `design/brand/`.

| File | Use |
|---|---|
| `star-shift-symbol.svg` | The logo as supplied, untouched. Use at **64 px and larger** (About, README, slides, video) |
| `star-shift-symbol-small.svg` | Small-size cut for **24–48 px** (nav rail, phone top bar). Same star and proportions; the ring and crosshair are heavier, the gaps wider and the hairline orange ring is left out, because at 34 px the original's lines are under 1 px and blur to grey |
| `favicon.svg` | The small cut on an ivory tile (`#E9E2D8`, radius 21%), so the black ring survives a dark browser tab |

The small cut and the favicon are derivatives drawn by the Design Studio. **Approved for the header and the favicon by Nithil (Sat 14 Nov 21:21) and by Kurucharan, the team designer (Sat 14 Nov 21:22, via the UI/UX chat).**

**Logo credit (Master, Sun 15 Nov 09:04): one wording everywhere.** "Logo: SI-generated with ChatGPT; small version and favicon redrawn as SVG by Claude." The badge beside the symbol reads **SI** (the Space Apps FAQ calls AI "Super Intelligence"), at the same size and contrast as the old "AI" mark. The line must be visible, not tooltip-only, wherever the logo appears: the app (map credit and About), the pitch deck, the thumbnail still and the design files.

**Rules**
- **Name:** "Star Shift", two words, both capitalised. Set in Instrument Sans 700 at 16 px next to the symbol. No tagline is locked in.
- **Where:** the symbol sits on the ivory shell only. Its black ring disappears on the dark stage, so it never goes on the stage, the loader or a photo without the ivory tile.
- **Size and space:** 40 px in the rail, 28 px in the phone top bar, never under 24 px. Keep clear space of a quarter of its width on every side.
- **Colour:** never recolour, tint, outline or add a shadow or glass to the symbol. Its orange (`#FF7600`) is brighter than the UI copper on purpose: the symbol is the one place that orange appears. Do not use it for keys, links or text (it fails contrast on ivory), and do not shift the UI copper towards it.
- **Page title:** "Star Shift · the infrared sky over time". Never "SPHEREx …" as the product name.
- **Decorative duplicates:** the symbol next to the written name takes `alt=""`; a symbol standing alone takes `alt="Star Shift"`.

## 1. Principles

1. **The data is the hero.** The image stage is the largest element at every size. Nothing may sit on, blur, tint or glare over the pixels.
2. **One light, from the top-left.** Every highlight, rim and shadow agrees with it.
3. **Three materials, each with one job** (section 3). Never mix them on one element.
4. **Honest labels.**
   - Observed values carry a sage "OBSERVED" tag. Computed values carry a copper "COMPUTED" tag.
   - Never show a fake status, a fake layer or fake data.
   - Anything not wired up gets a dashed "PROPOSAL" tag (class `.proposal`).
5. **Fits any window.** Fluid grid, no fixed page widths, no page-level horizontal scroll. Laptops (1366×768, 1536×864, and 125%/150% Windows scaling) are the main target.

Branding rules:
- No NASA or SPHEREx logos, names-as-brand or spacecraft art.
- The brand is **Star Shift** with its symbol (section 0). Nothing else is used as a brand.
- The data credit "Images: NASA SPHEREx via IRSA" is required.

---

## 2. Colour tokens (contrast checked, WCAG 2.2 AA)

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--shell` | `#E9E2D8` | page / app shell (warm ivory) | – |
| `--shell-hi` / `--shell-lo` | `#F6F1EA` / `#DCD3C7` | shell gradient ends | – |
| `--light` | `#FFF8EC` | warm light falling from the top-left (radial gradient) | – |
| `--ink` | `#27211C` | primary text | 12.4:1 on shell, 13.9:1 on solid glass |
| `--ink-2` | `#4A4038` | secondary text, labels | 7.9:1 on shell, 7.1:1 on wells |
| `--muted` | `#655A50` | tertiary text, small hints | 5.2:1 on shell, 5.9:1 on glass, 4.6:1 in wells |
| `--copper` | `#8A4719` | link text, focus ring, active tick, computed tag text | 5.5:1 on shell |
| `--copper-key` | `#A85F2A` | top of the primary key gradient | white text 4.6:1 (bottom 6.7:1) |
| `--copper-deco` | `#C27A43` | decoration only (ring key, playing collar); never text | – |
| `--on-copper` | `#FFF8F0` | text on copper keys | see above |
| `--sage` | `#46604A` | OBSERVED tag text on `--sage-tint` | 5.5:1 |
| `--sage-tint` | `rgba(111,138,114,.17)` | OBSERVED tag fill | – |
| `--coral` | `#A4452F` | error accent (dot, never alone: always with words) | – |
| `--edge` / `--edge-strong` | `rgba(84,62,42,.26)` / `.42` | key and well borders | non-text 3:1 met by `--edge-strong` on wells |
| `--well-top` / `--well-bot` | `#D9D0C3` / `#E6DFD5` | recessed wells | – |
| `--glass-tint` / `--glass-tint-2` | `rgba(255,252,247,.58)` / `rgba(250,245,238,.44)` | liquid glass fill | text always sits on a tint, never raw glass |
| `--stage` | `#15110E` | image stage (flat) | – |
| `--stage-text` / `--stage-muted` | `#EDE5DA` / `#B5A898` | text in stage margins | 15.0:1 / 8.1:1 |
| `--ring` | `#E3A86B` | predicted-position ring on the image (dashed) | – |
| `--cross` | `#9DB89F` | first-season reference cross (Compare/Blink) | – |
| `--mask-bg` / `--mask-ink` | `#211B16` / `#6B5D50` | no-data hatching | – |
| `--focus` | `#8A4719` | focus outline 2.5 px, offset 3 px | 5.5:1 vs shell |

Rules:
- Gold, navy, purple, cyan and neon are banned (from Kurucharan's DON'Ts).
- Copper means action, selection or computed. Sage means observed. Coral means error.
- The page must still read with every accent removed.

Image colour scales (the science image is drawn by code, `render.js` → `R.ramps`):
- **Copper** (default): `#0C0907 → #3E1C0E → #B06430 → #E8B678 → #FFF6E8`.
- **Grey** (Clarity option, for colour-blind or print use): `#0A0908 → #FAF8F5`.

---

## 3. Material rules (which "morphism" goes where)

| Layer | Material | How |
|---|---|---|
| App shell, nav rail | **Soft neumorphism** (big calm surfaces only) | `linear-gradient(160deg, --shell-hi, --shell-lo)`, light shadow `-6px -6px 14px rgba(255,255,255,.7)`, dark `8px 10px 22px rgba(84,62,42,.16)`, radius 24 |
| Physical controls: keys, play knob, segmented controls, switches, scrubber thumb, search field | **Tactile skeuomorphism overpowers neumorphism** | Keys: top-lit gradient `#FCFAF6 → #E7E0D5`, 1 px `--edge` border, inner top highlight, three-layer shadow (contact `0 1px 1px`, near `0 3px 6px -1px`, far `0 12px 22px -10px`, all `rgba(60,40,24,…)`). Pressed: `translateY(1px) scale(.97)` + inset shadow (shadow compresses). Wells (field, tracks): inverted gradient + inset shadow + 1 px white lower lip |
| Floating layers: top bar, playback dock, info panel, stage tool rail, popovers, toast | **Liquid Glass overpowers classic glassmorphism** | Tinted fill + `backdrop-filter: blur(14px) saturate(1.35)`, specular rim (`::before`, masked 1 px border gradient, bright top-left), inner top line `inset 0 1px 0 rgba(255,255,255,.95)`, layered drop shadow. **Refraction** (Chromium only): SVG `feDisplacementMap` with an edge-only displacement map on the 3 hero surfaces (top bar, dock, info panel); see `refraction()` in the prototype. Other browsers fall back to blur automatically |
| Image stage | **Flat** | `--stage` fill, recessed bezel (inset shadow + 6 px shell-coloured collar). No glass, blur, glare or gradient over the pixels. Glass may only float in the stage's empty margins (tool rail, wavelength chip) or overlap its outer edge (info panel) |
| Text | Solid colour | Never on raw glass: the glass always has a tint layer |

Glass budget: **at most 4 live `backdrop-filter` layers** (top bar, dock, info panel, tool rail).
- Popovers are near-opaque (tint .95), so they stay legible over the dark stage.
- On tablet and phone the info panel becomes an opaque sheet (no backdrop filter).

Cursor glare:
- A radial highlight `rgba(255,255,255,.10)` that follows the pointer on glass, eased with lerp (factor 0.18) inside `requestAnimationFrame`.
- Only on `(hover:hover) and (pointer:fine)`; off with Reduce motion and Reduce transparency.

---

## 4. Typography

- **UI:** Instrument Sans 400/500/600/700 (Google Fonts).
- **Numbers, coordinates, dates, µm:** IBM Plex Mono 400/500, `font-variant-numeric: tabular-nums`. Class `.num`; `dd` values use it automatically.
- Base size `0.9375rem` (15 px). All type is in `rem`, so the root size drives Larger text: root 115%, and 106.25% / 115% at ≥1900 / ≥2300 px wide.

| Role | Size | Weight |
|---|---|---|
| Target name (info panel) | `clamp(1.125rem, .8vw + .7rem, 1.5rem)` | 700, tracking −0.015em |
| Product name (top bar) | 1rem | 700 |
| Popover title | 1rem | 700 |
| Section heading (info panel) | .875rem | 600 |
| Body / controls | .875–.9375rem | 400–600 |
| Labels, captions, timeline | .75–.8125rem | 500–600 |
| Tags (OBSERVED/COMPUTED) | .6875rem caps, tracking .05em | 700 |
| Stage state headline | `clamp(1rem, .6vw + .8rem, 1.25rem)` | 600 |

Minimum text size is 12 px. The only exceptions are 11 px all-caps tags, which are bold and high-contrast.

---

## 5. Spacing, radius, layout

- 8 px grid: `--s1 4`, `--s2 8`, `--s3 12`, `--s4 16`, `--s5 24`, `--s6 32`.
- Outer gap: `--gap: clamp(8px, .9vw, 14px)`.
- Radii: keys 11, wells 11–15, glass 20, shell/stage 24, chips 999.

App grid (`.app`, `height: 100dvh`):
```
desktop ≥1100:  columns 64px | minmax(0,1fr) | clamp(260px,21vw,340px)
                areas  "rail top top" / "rail stage insp" / "rail dock dock"
≥1600: 72px | 1fr | 340px      ≥2300: 80px | 1fr | 400px
tablet 700–1099: 60px | minmax(0,1fr); info panel = slide-over sheet from the right (Info button)
phone <700:     one column: top bar → stage (aspect 1/1.08, max 66dvh) → dock; no rail;
                info panel = bottom sheet (Info button); page may scroll vertically
```
- The info panel overlaps the stage's right edge by `--overlap: clamp(16px,2.2vw,36px)`, and the stage pads its right side by the same amount, so the panel never covers pixels.
- Container queries change the internals:
  - top bar: hide the coordinates below 1020 px; wrap the quick picks below 620 px; icon-only Clarity below 520 px;
  - dock: hide group labels below 1480 px; the timeline takes its own row below 860 px; phone order is transport, timeline, view, speed, layers.
- `body { overflow:hidden }` on ≥700 px, so the app never shows page scrollbars.

**Crisp image scaling (required):**
- A `ResizeObserver` on the stage computes `cell = floor(min(availW, availH) / 25)` CSS px per data pixel (an integer, so pixels stay square).
- The canvas backing store is `25 × round(cell × devicePixelRatio)`, drawn with `image-rendering: pixelated`.
- Compare mode uses `min((w−24)/2, h−28)`.
- Zoom is integer only (fit, 2×, 3×, 4×) with drag-to-pan.
- Stage margins: top 52, bottom 44, left 76 (tool rail), right `--pad-r`. Phone margins: 48 / 58 / 12 / 12.

---

## 6. Components

| Component | Spec |
|---|---|
| **Search** | Recessed well with a search glyph and placeholder "Star name, or RA Dec like 269.45 +4.69", plus the copper **Show** key (the one primary action on screen). Below or beside it, quick-pick keys for the 5 NASA test targets; the current target shows pressed. The quick-pick row scrolls sideways with a fade mask, never wraps the page |
| **Top bar** | Glass. Holds the name, search, quick picks, coordinates readout (mono) + copy key (icon swaps to a check, "Copied" for 1.6 s, confirm sound), an Info key (tablet/phone only), the Clarity key and the `?` help key |
| **Stage** | Flat dark. Contents: wavelength chip top-left (`λ 4.93 µm · D6 · 15 Aug 2025`, mono, translucent dark pill with no blur); glass tool rail in the left margin (zoom in, zoom out, fit + level readout, ring toggle); N/E compass bottom-left; 30″ scale bar bottom-right (length = `cell × 30 / 6.15`); Blink flag top-right |
| **Frame player** | Prev key, **play knob** (56 px dome with a machined collar; playing = copper collar + copper pause icon), next key, frame counter `07 / 60` in mono. Manual steps "tick" the counter through the digits between (≤12 steps); playback just sets it |
| **Season timeline (scrubber)** | Recessed track. Each observing season is a raised segment; each image is a tick (current = copper, not yet loaded = 12% opacity); the thumb is a skeuo cap with a copper index line that grows 1.14× while grabbed. Snaps to the nearest image; detent sound when crossing a season boundary. Header: "Season 1 of 3 · Aug–Oct 2025" + date; season names under the track. Keyboard ←/→. `role=slider` with valuenow/valuetext |
| **View switch** | Segmented well, equal-width segments, one sliding key (`transform` only, 300 ms spring curve). **Time** = play through images. **Compare** = first vs last season stacks side by side with a sage cross at the first-season position. **Blink** = flips the two stacks every 600 ms (1500 ms with Reduce motion). Switching morphs the stage with the View Transitions API when motion is allowed |
| **Speed** | Segmented: Slow 2 / Normal 4 / Fast 8 images per second |
| **Layers** | IMAGE (always on, disabled-pressed) and FLAGS (toggles the no-data hatching). Extended in section 23 (Layers bar: IMAGE / VARIANCE / ZODI / WAVE + FLAGS) |
| **Info panel** | Glass ("source inspector"). Sections: target name + RA/Dec + Copy coordinates; **This image** [OBSERVED] (date, UTC time, detector, wavelength, no-data pixels n/625); **Where it should be** [COMPUTED] (one plain sentence + ring switch); *More detail* disclosure (image count, MJD, pixel size, field, stretch); credits. In Compare/Blink the heading names the image shown ("Right: last season") |
| **Switch** | Recessed track 46×26; skeuo knob 20 px that squashes (`scaleX(1.18)`) while pressed; on = copper track |
| **Popovers** | Clarity, Help/About: near-opaque glass, `transform-origin: top right` (they grow from their button), open with `scale(.96)→1` + opacity on the spring curve (300 ms). Close with Esc or a click outside; focus moves into the panel |
| **Toast** | Small glass pill above the dock, 2.4 s. Used for "All 60 images are in." and for "This mockup only holds Barnard's Star…" |
| **Loading** | Images arrive one by one. Until 8 have arrived, the stage shows a headline, a count (`14 / 60`) and a grid of arriving thumbnails. After that the stage shows the images (playable) with a thin copper progress line above the bottom margin, and pending timeline ticks stay faint. At the end: confirm sound + toast |
| **Error** (IRSA down) | Stage message with a coral dot: "The NASA archive (IRSA) isn't answering". Says how many images arrived and are kept. Actions: **Retry** (fetches only missing images) and **View the 27 images**. Error sound once |
| **Empty** | "No SPHEREx images cover this spot", "Nothing was found within 0.05° of these coordinates. Check the numbers, or try one of the examples above." |

Copy rules: buttons name their action. Errors name the problem and the way out. Write plain words (Kurucharan and the public are the audience); put scientific detail in "More detail".

---

## 7. Motion

| What | Duration | Curve |
|---|---|---|
| Key / knob press, hover lift (1 px) | 140 ms | `--ease-out cubic-bezier(.23,1,.32,1)` |
| Switch, colour changes | 180 ms | spring / ease |
| Segmented key slide, popovers, sheets | 300 ms | `--spring cubic-bezier(.32,.72,0,1)` (critically damped feel, no overshoot) |
| View morph (Time/Compare/Blink) | 280 ms | View Transitions, same spring |
| Scrubber thumb | 180 ms follow, 140 ms grow | ease-out |
| Glare | per frame, lerp 0.18 | rAF, stops when settled |

- Animate only `transform` and `opacity` (filter only on small elements).
- No loops, particles, radar, orbits or starfields.
- Popovers grow from their trigger. Nothing animates from `scale(0)`.
- Keyboard actions are instant.
- Hover effects only under `(hover:hover) and (pointer:fine)`.

**Reduce motion** (Clarity, defaults to `prefers-reduced-motion`): all transitions become instant; no springs, glare, morphs or number ticking; Blink slows to 1.5 s.

---

## 8. Sound

Synthesised in code with the Web Audio API (no audio files, no AI audio). The credit line says "UI sounds synthesised by AI-written code".

| Event | Sound |
|---|---|
| Key press, play/pause, zoom, toggles | click: 1700 Hz triangle 35 ms + 850 Hz sine 45 ms |
| View/speed switch, popover open, single step | tick: 2400 Hz sine 25 ms |
| Crossing a season boundary (scrub or step) | detent: 1300 Hz triangle 30 ms |
| Results loaded, coordinates copied | confirm: 660 Hz then 990 Hz sine, about 120 ms total |
| Error | 240 Hz → 190 Hz triangle, about 120 ms |

Rules:
- Peak gain ≤ 0.063 (about −24 dBFS); each sound ≤ 120 ms; throttle 45 ms.
- No sound per frame during playback, no hover sounds, no loops.
- The AudioContext is created on the first pointer or key event (autoplay rules).
- Sound defaults on but quiet; it defaults off when the system asks for reduced motion. The choice is remembered.

---

## 9. Clarity and accessibility

Clarity popover (top-bar key with a half-filled circle icon).

All choices are saved in `localStorage` under the key `tgi-clarity-v1`, with every read and write wrapped in try/catch. They start from the OS settings and apply as attributes on `<html>`.

| Setting | Effect | Default |
|---|---|---|
| Reduce motion | `data-motion=reduce` (section 7) | `prefers-reduced-motion` |
| Reduce transparency | `data-glass=solid`: glass becomes `#F3EEE7`, no backdrop filter, no glare, no refraction | `prefers-reduced-transparency` |
| Increase contrast | `data-contrast=more`: darker ink (`#0E0B09`), strong edges, glass opaque, flat key shadows | `prefers-contrast: more` |
| Larger text | `data-text=large`: root font about 115% | off |
| Sound | on/off | on (off with reduced motion) |
| Brightness stretch | Auto (asinh, 2–99.7%) / Linear / Strong (asinh×30, 5–99%) | Auto |
| Colour scale | Copper / Grey | Copper |
| Show no-data hatching | hatched vs plain masked pixels (same as the FLAGS layer) | on |
| Show predicted-position ring | dashed ring (same as the tool-rail and info-panel toggles) | on |

Accessibility:
- Visible focus everywhere (2.5 px copper, 3 px offset).
- Touch targets 44 px on phone (keys, segments, picks); 40 px minimum on desktop.
- Shortcuts:

  | Key | Action |
  |---|---|
  | Space | Play / pause |
  | ← / → | Step |
  | T / C / B | Time / Compare / Blink view |
  | ? | Help |
  | Esc | Close panels |

  Shortcuts are ignored while typing in search.
- An `aria-live="polite"` region announces "Image 7 of 60, 25 Aug 2025, 4.41 micrometres" on manual steps, never during playback.
- Canvas images have role `img` with labels.
- The info sheets have a close key, Esc and a scrim.

---

## 10. Phone layout (<700 px)

1. **Top bar** (glass), in three rows:
   - name with Info / Clarity / ? icon keys;
   - full-width search + Show;
   - quick-pick row that scrolls sideways.
2. **Stage**: square-ish, width 100%.
   - Wavelength chip top-left, scale bar top-right.
   - Tool rail as a horizontal glass bar at the bottom centre; compass bottom-left.
3. **Dock** (glass), in this order:
   - transport (knob 52 px) and counter;
   - season timeline (season labels hidden; the header names the season);
   - view switch at full width;
   - speed + layers.
4. **Info**: bottom sheet (max 76dvh, opaque) from the Info key, with a scrim to close.

---

## 11. For Coding: how to build it

- **No framework needed.** One HTML page, one CSS file (sections 2–10 as custom properties) and plain JS modules: renderer (`render.js`), player, timeline, settings, sound, refraction.
- **Reuse:**
  - `R.stretch` / `R.draw` (cell, ring, hatch, stretch, ramp options);
  - `R.visits` for seasons;
  - `R.fmtRA` / `R.fmtDec` / `R.fmtDate` for formatting.
- **Data shape:** the frame data in `assets/data.js` matches `evidence/frames_*.json` (`exp` = expected position in pixels, `d` = 625 values or null for masked).
- **Keep the refraction optional.** Feature-detect Chromium; otherwise use the plain blur. It must not run with Reduce transparency or Increase contrast, or on fixed sheets.
- **What is mockup-only in E (do not ship):**
  - the "Mock" state switch;
  - the URL switches (`?glass=solid&mode=compare&clarity=open&state=…`);
  - the quick-pick toast saying only Barnard's Star is loaded;
  - "Design mockup" in the credits.
- **Decided (Nithil, Sat 14 Nov 21:13):** the name is Star Shift and the logo is the symbol in section 0 (40 px in the rail; 28 px at the start of the top bar on phone, where the rail is hidden). **Still open:** any feature beyond this viewer.


---

# Team features (v2): sections 12–17

The team decided these features; their words are in "05 Idea – team decides", under TEAM FEATURE LIST. This part designs how they look and behave and adds nothing to them. Flagging features are out of scope until Nithil's metadata PDF arrives.

Reference build: `design/mockups/direction-e-features.html`.
- Mock switch (bottom left): Ready / Load / **Slow** / Error / Empty.
- URL switches for screenshots: `?scene=viewer`, `?bands=open`, `?obs=colombo`, `?state=slow`.
- Screenshots in `design/mockups/shots/features-*.png`.

**One flow:** the sky map comes first. Search or drag to a spot, select a patch, and the details panel fills in. "Play this patch over time" zooms into the flip-book. The map key (top of the tool rail) or **M** goes back.

`<div class="app" data-scene="map|viewer">` switches what shows. The stage, top bar, dock and info column are shared, so nothing jumps.

## 12. Sky map (feature 1)

**Anatomy**, all inside the existing flat stage:
- `<canvas>` with the RA/Dec graticule. Lines are `rgba(255,235,210,.09)`; the equator is `.24`. Labels are IBM Plex Mono 11 px `rgba(205,190,172,.78)`: Dec on the left after the tool rail, RA along the bottom.
- Target pins: real targets only, as 28 px `<button>`s with an 8 px dot.
- Centre reticle.
- **Selection box:** 1.5 px `--ring` outline, labelled "SELECTED PATCH". Its size is the real cutout (150″), minimum 26 px.
- Readout chip (top-left, mono): `FOV 60.2° × 37.0° · 17h 57m 47.1s +04° 46′ 06″`.
- A dashed placeholder note naming what the background will be.

**Background honesty:** never a fake starfield.
- The mockup shows the graticule plus the 5 test targets.
- The real site puts survey image tiles under the same graticule. Coding picks the source (e.g. HiPS via Aladin Lite) and credits it.
- Keep the placeholder note until real tiles exist.

**Projection:** a local equirectangular projection around the view centre, north up and RA increasing to the left (east left, as in the flip-book). An Aladin-type library replaces this in the real site; keep the same look on top of it.

**Controls:**

| Input | Action |
|---|---|
| Drag | Pan |
| Wheel | Zoom around the cursor (`exp(−deltaY × 0.0016)`) |
| Click / tap | Select (snaps to a pin within 16 px) |
| Tool rail +/− | Zoom ×1.6 |
| Fit | Back to a 60° FOV |
| Map focused: arrow keys | Pan 10% |
| Map focused: + / − | Zoom |
| Map focused: Enter | Play the selected patch |

The map wrapper is `role=application` with an aria-label listing those keys. Zoom runs from the whole sky to about 5,200 px per degree, where the 150″ cutout is about 215 px.

**Dock in map scene:** Cursor RA/Dec · Field of view · Selected · **Play this patch over time** (primary copper key).

**Search and quick picks** fly the map to the target (650 ms ease-in-out, instant with Reduce motion) and then select it. Accepted input is a star name or `RA Dec` in degrees. Anything else gets a toast with an example.

**Zoom-in transition:** the map flies in so the selection box fills about 42% of the stage height (520 ms). Then a View Transition morphs the selection box (`view-transition-name: shot-a`) into the flip-book canvas (`#cvA`, same name). Only one element carries the name in each scene. Back to the map reverses it. Reduce motion makes the switch instant.

**States:**
- The mockup holds only Barnard's Star data. Playing any other patch shows a toast ("The real site asks IRSA for this patch").
- The real site shows the loading screen (section 17).

**Phone:**
- Same map; the readout chip is full width, and the placeholder note sits above the tool rail.
- Selecting opens the details bottom sheet (max 46dvh) and pans the map up 24% so the selection stays visible above the sheet.

## 13. Coordinate details panel (feature 2)

It lives in the glass info column (desktop, top-right, overlapping only the stage edge), a slide-over sheet (tablet) or a bottom sheet (phone). It never covers the selection.

**Anatomy, top to bottom:**
1. Name (target name or "Unnamed patch") and sub-line (catalogue ID, or "Selected by you on the map"), then a full-width primary key, **Play this patch over time**.
2. **Position:**
   - RA as hms · degrees, and Dec as dms · degrees;
   - galactic l, b;
   - ecliptic λ, β;
   - constellation.
3. **SPHEREx coverage:** images, date span, detectors.
4. **Motion:** the shift between the first and last season, and the catalogue proper motion, **only when measured**. Otherwise the quiet line "No measured motion here." There is no velocity row: we have no measured velocity.
5. **Nearby objects:** up to 3 rows (name, "12.4° away"). Clicking one flies the map there and selects it.
6. **Observer:** section 16.
7. A legend line explaining the three tags.

**Value rows** (`.cd-row`):
- First line: label (12 px muted) on the left and tag on the right. Second line: value (Plex Mono 13 px), which may wrap.
- A 30 px copy key on the right; on click the icon swaps to a check for 1.5 s, with the confirm sound.
- Tags are words, never colour alone:

  | Tag | Style | Means |
  |---|---|---|
  | `OBSERVED` | sage | from SPHEREx images or the archive |
  | `COMPUTED` | copper | worked out in the browser |
  | `CATALOGUE` | neutral `rgba(84,62,42,.10)` | from star catalogues |

**Truth rules:**
- Galactic, ecliptic, separations, alt/az and rise/set are computed in the browser:
  - galactic: J2000 pole 192.85948°, 27.12825°, l_NCP 122.93192°;
  - ecliptic: obliquity 23.4392911°;
  - separations: haversine.
- Constellation needs the IAU boundaries. Until Coding adds them, unnamed patches say "the real site looks this up".
- Coverage for an unnamed patch reads "Not checked yet. Play this patch to ask IRSA."
- Never fill a value that wasn't measured or looked up.

## 14. IR band-range editor (feature 3)

**Opened from** the tool-rail key "IR band ranges" (viewer scene). It is a wide near-opaque popover (`min(640px, 100vw−24px)`) that grows from that key (`transform-origin: top left`).

**Facts shown** (from the SPHEREx Explanatory Supplement v2.0):

| Detector | Range |
|---|---|
| D1 | 0.744–1.116 µm |
| D2 | 1.099–1.651 µm |
| D3 | 1.636–2.421 µm |
| D4 | 2.423–3.822 µm |
| D5 | 3.809–4.420 µm |
| D6 | 4.412–5.002 µm |

- 102 channels, 17 per detector. The editor domain is **0.74–5.01 µm**, which covers both the team's 0.75–5.01 and the supplement's 0.744–5.002.

**Anatomy:**
1. The detector row: dashed boxes D1–D6 at their real spans.
2. The ruler: a 1.5 px baseline, minor ticks every 0.25 µm, labels at 1–5 µm.
3. **One lane per range:** a recessed track holding a raised colour band. The name sits inside the band, with text colour picked for contrast (dark on light colours, ivory on dark). Each end has a skeuo handle.
4. **Rows:** colour swatch (36 px) · name (inline input) · from / to number fields (step 0.01, Plex Mono) · delete key. A warning line sits under each row.
5. The swatch opens an inline palette: 10 named presets (Copper, Sage, Slate, Heather, Straw, Brick, Moss, Clay, Plum, Stone) plus a hex field.
6. Actions: **+ Add range** and **Reset to defaults**, then the placeholder note.

**Interaction:**

| Input | Effect |
|---|---|
| Drag a band | Moves it |
| Drag a handle | Resizes it (snaps 0.01 µm, kept inside the domain, min width 0.01) |
| Handles (`role=slider`), ←/→ | ±0.01 |
| Handles, Shift+←/→ | ±0.1 |
| Number fields | Accept typing |

Changes save to `localStorage` key `tgi-bands-v1`.

**Validation:** shown inline, in words, coral.
- "Min must be smaller than max." The bad value is reverted.
- Values outside the domain are clamped, with "Kept inside 0.74–5.01 µm."
- Overlap: "Overlaps Default 2 (allowed)."
- A colour too close to another range's colour (redmean distance < 70): "Colour looks close to …; the names still tell them apart."

**Defaults (Nithil, decided):**

| Band | Range (µm) | Colour |
|---|---|---|
| Starlight | 0.74–1.11 | `#5B8CFF` |
| Cool Stars | 1.11–1.64 | `#3FC1C9` |
| Through the Dust | 1.64–2.42 | `#7BD389` |
| Water Ice | 2.42–3.82 | `#F2C14E` |
| CO₂ Ice | 3.82–4.42 | `#F28C38` |
| Brown Dwarfs | 4.42–5.01 | `#E5484D` |

- They are data colours: never text on ivory, and always shown with the name beside the swatch.
- Each row may carry Nithil's one-line description under its inputs (`grid-column: 2 / -1`).

**Effect in the viewer:**
- Timeline ticks take the colour of the range containing that image's wavelength. The current tick stays copper with a 1.5 px ring in the range colour.
- The wavelength chip starts with a swatch and the range name: "■ Default 6 · λ 4.93 µm · D6 · date".
- Not-yet-loaded ticks stay faint.

**Phone:** the popover goes full width. Rows keep the same order with 72 px number fields.

## 15. Star name labels (feature 4)

- **Where:** map pins, and the viewer stage (Time view). On the stage there is a hit area the size of the predicted-position ring around the target, and one around the brightest other source in the first-season stack.
- **Tooltip:** a near-opaque glass pill (no backdrop filter, so the glass budget still holds).
  - Name in Instrument Sans 600 13 px; the catalogue ID in Plex Mono 12 px muted.
  - Placed **to the right of** the ring or pin (8 px gap), flipping left at the viewport edge, so it never covers the ring or the star.
- **Timing:** on mouse hover it appears after **120 ms** (opacity + 3 px rise, 120–160 ms) and hides on leave. Keyboard focus and touch-tap show it at once (touch hides after 2.5 s); Esc hides it.
- **Content truth:**
  - Real names and IDs only: Barnard's Star / GJ 699, WISE 0855 / WISE J085510.83−071442.5, ε Indi Ba/Bb, and "variable star" for RW Aur and R Dra.
  - An unmatched source says "Unidentified source: not matched to a catalogue in this mockup; the real site looks it up."
  - Hit areas are hidden in Compare and Blink.

## 16. Observer location (feature 5)

It lives in the coordinate details panel, section "Observer".

- **Off by default.** A switch labelled "Use my location for alt/az and rise/set".
- Right under it, always visible, with a lock icon: **"Your location stays in your browser. It is never sent or saved anywhere."**

**When on**, there are two ways in:
1. **Use device location:** browser geolocation (8 s timeout), rounded to 0.001°.
2. **Type a place:** a city from a short **built-in offline list**, or `lat, long`. There is no online geocoding, which keeps the privacy promise true. The line under the field says so.

**States:**

| State | What shows |
|---|---|
| Asking | "Asking your browser for your location…" |
| Denied / unavailable | Coral: "Location permission was blocked or unavailable. Type a place instead." Focus moves to the field |
| Unknown place | Coral: "We don't know “x”. Type a big city (e.g. Colombo, London) or latitude, longitude like 6.93, 79.86." |
| Set | "Colombo · 6.93°, 79.86°" + **Clear** key; status dot "Up now" (sage) or "Below the horizon now" (muted); rows tagged COMPUTED: Altitude / azimuth now, Rise, Highest (transit), Set, or "Never rises / never sets from here"; times in the browser's time zone with "today / tomorrow"; refreshes every 30 s |

**Maths:**
- Local sidereal time from the JD.
- Standard alt/az.
- Rise/set at h₀ = −0.5667° (refraction).
- If the star is up now, show the current pass; otherwise the next.

Never store the location; it is kept in memory only.

## 17. Loading screen: the astronaut loop (feature 6, Design v1.1)

History: rocket loaders v1 and v2 were dropped by Nithil at ~20:15 for a code-built loader. At ~20:50 he asked for the professional astronaut render back as **loader v1.1**. The code-built scan loader stays as the fallback (17b).

**Files:** `design/loader/v1.1/` (copy the whole folder **except `_build/`**; its README has the exact embed).

| File | Use |
|---|---|
| `astro-loader.js` + `astro-loader.css` | The component. Same calls as `ScanLoader`: `set`, `add`, `slow`, `done`, `destroy` |
| `astronaut-loop-1080.webm` / `.mp4` | The 8 s seamless loop, 1920×1080, 30 fps (VP9, then H.264 for Safari) |
| `astronaut-loop-720.webm` / `.mp4` | 1280×720, used at ≤ 900 px wide, ≤ 560 px tall, or with Save-Data |
| `astronaut-exit-1080` / `-720` `.webm` / `.mp4` | The 1.5 s exit clip, played once when loading ends |
| `astronaut-still-1080.webp` / `-720.webp` / `astronaut-still.png` | Video poster and the Reduce-motion picture |

The videos are full-frame with their own sky, so there is no alpha channel, and MP4 is the fallback format (not animated WebP).

**The picture** (SI-generated, SI = AI: modelled and rendered by Claude in Blender 5.2, Cycles)
- An astronaut in a realistic EVA-style suit with a gold visor rides a two-stage rocket with two side boosters.
- Direction E colours only: ivory hull and suit, copper rings and engine bells, sage bands, warm graphite. The flame runs ivory → copper.
- Background: the real NASA SPHEREx all-sky map (IRSA DR1), shown through the app's copper image scale.
- Motion is slow and weighty: a slow camera drift around the rider, a few degrees of sway, a breathing flame, dust motes streaming past. Nothing bounces.
- No NASA or agency logos, insignia or lettering, no real spacecraft likeness, no face (the visor is opaque).
- A small **"SI-generated" mark is baked into the bottom-right corner of every frame** and the stills, so recordings keep it. The raw frames in `_build/` have no mark: never publish them.

**Screen** (the component draws all of this; `.al` fills the stage)
- The loop with `object-fit: cover`, fading in over the still (240 ms) once it plays.
- A bottom shade: `linear-gradient(180deg, transparent 50%, rgba(11,9,7,.78))`.
- **Progress, bottom centre:** "Finding images of Barnard's Star · **12** of 60 loaded" (14 px, number in Plex Mono, text shadow, `aria-live="polite"`).
- A **2 px hairline** along the bottom edge (`--ring`), scaled with real progress. Nothing rides a bar.
- **Slow / retry:** a dark glass pill above the line ("IRSA is slow. 5 of 60 kept. Retrying 3 images" + **Retry now**). The video pauses until loading resumes.
- **After 8 images:** a copper **Start watching** key rises in (300 ms).
- **Caption, bottom-left, always visible:** "Animation: SI-generated (made by Claude in Blender) · Background: NASA SPHEREx all-sky map (IRSA)", 11 px `#EDE5DA` on a `rgba(11,9,7,.62)` scrim.
- **Exit** (Start watching, or the last image arriving): the text and hairline fade out (150 ms), the 1.5 s exit clip plays once on top (the rocket pulls away and the frame fades to the stage colour), then the loader fades out over 400 ms into the flip-book. `done()` returns the wait in ms: 1900 with the clip, 400 if the clip is not ready or the whole load took under 4 s (cached data: decoration never lengthens a short wait), 0 with Reduce motion. The flip-book starts playing when the loader has gone, not under it.
- **Reduce motion:** the still, the same text and hairline, an instant cut. No video is loaded.
- **If the media cannot load:** the component hands over to the scan loader (17b) when the page has it, replaying the images that already arrived.
- **Sound:** none during the loop; the soft "loaded" confirm at the end.
- **Phone:** the 720 files, the same overlays, the line lifted to 64 px.

### 17b. Fallback: the scan loader (the data assembling itself)

Built in code from the real images: no video, no AI imagery, no watermark. It is the fallback for 17 and can be switched on instead with one constant.

**Component:** `design/loader/scan/scan-loader.js` + `scan-loader.css` (about 16 KB together, plain JS). Its README has the embed code. Demo: `design/mockups/loader-scan.html`.

**Mode `scan`: "Spectral scan"** (the default)
- **Plate:** the newest image to arrive, centred, at whole-pixel scale (the same crisp scaling as the flip-book), tinted through its colour band: `#0C0907` → band colour → `#FFF6E8`. Masked pixels stay hatched. Each arrival reveals top-down in 220 ms (`clip-path` + opacity); images arriving less than 400 ms after the last reveal swap in place, so a burst never flickers.
- **Caption** (Plex Mono 13 px): band swatch and name · `λ 4.46 µm` · `D6` · `17 Aug 2026`.
- **Wavelength ruler** (0.74–5.01 µm, max 820 px wide): faint spans for the six bands with their names; a faint 1 px tick for every expected image; each tick becomes a 2 px tick in its band colour when the image arrives; the newest is a taller ivory tick. Labels at 1–5 µm.
- **Date line:** the same ticks by date, grouped into observing seasons (runs less than 60 days apart) drawn as faint rounded spans with month labels.
- **Footer:** "Finding images of Barnard's Star · **41** of 60 loaded" (14 px, number in Plex Mono, `aria-live="polite"`); a retry pill when the archive is slow ("IRSA is slow. 5 of 60 kept. Retrying 3 images" + **Retry now**); a copper **Start watching** key after 8 images.

**Mode `sheet`: "Contact sheet"** (the palette-only alternative)
- A centred grid of small tiles, one per arrived image, in the copper image scale (up to 120 tiles, then "+N more"). Each fades in at 260 ms.
- The same date line and footer. No wavelength ruler and no band colours.

**Rules for both**
- Honest progress only: every tick and tile is a real image that has arrived. Nothing is animated for its own sake.
- Band colours are data colours: they appear on the plate, the ticks and the swatches, never on text. The UI stays ivory, copper and warm graphite.
- **Exit:** on Start watching, or when the last image arrives, the loader fades out over 400 ms (spring curve) into the flip-book, which keeps its 2 px progress line until everything has arrived.
- **Reduce motion:** no reveal or fade-in animation; everything still updates.
- **Sound:** none while loading; the soft "loaded" confirm at the end.
- **Phone:** the plate on top, the rails stacked with labels above them, band names hidden (the caption names the band), the retry pill wraps.
- **Performance:** two small canvases for the rails and one for the plate; redraws only when an image arrives or the stage resizes.


---

# Design v1.1 (v3.1): sections 18–22

This is the whole app as Coding built it (live at http://127.0.0.1:8787, built from the E/E+ markup). **The build decides what exists; E decides how it looks.**

Reference prototype: `design/mockups/design-v1.1.html` (the old `design-v1.html` address redirects to it). Screenshots: `design/mockups/shots/design-v1-*.png` and `design-v1.1-*.png`.

Nithil's feedback of Sat ~18:00 is folded in:
- a 3D sky (section 18);
- cursor and hover motion you can actually see (section 19);
- the loading screen: a professional 3D astronaut render (section 17, loader v1.1), with the code-built scan loader as its fallback (17b).

## 18. The 3D sky (art direction for Coding's three.js sky)

**Idea:** you stand at the centre of the celestial sphere. Drag to look around, zoom in, and the real SPHEREx survey takes over as you get close. Then "Play this patch over time" drops you into the flip-book.
- It must feel like a quiet observatory, not a sci-fi game.
- Real data only: no painted stars, no particles, no twinkle, no lens flares.

**Camera**
- Perspective camera at the origin, looking out.
- Drag = yaw/pitch with damped inertia (damping 0.12 per frame, stop under 0.01°/frame). Pitch is clamped at ±89.5° so it never flips.
- Wheel or pinch = field of view from **100° down to 0.5°**, zooming toward the pointer. Pinch zooms around the midpoint.
- Keyboard (sky focused): ←/→/↑/↓ rotate 5% of the FOV; +/− zoom ×1.25; Enter = Play this patch.

**Sky background**
- Flat `--stage` `#0E0B09`, with no gradient sky, horizon or ground by default (this is space, seen from the observer's sphere).
- **Only when observer location is on** (section 16): draw a soft horizon.
  - Everything below altitude 0° gets a `#1C1611` veil at 82% opacity with a 2° feathered edge.
  - Place N / E / S / W labels (Plex Mono 11 px, `--stage-muted`) on the horizon.

**Stars (real catalogue only**, e.g. the Yale Bright Star Catalogue or HYG, magnitude ≤ 6.5, about 9,000 stars; credit it in the footer)
- **Size:** `px = clamp(1.2, 1.2 + (6.5 − V) × 0.85, 7) × min(devicePixelRatio, 2)`, drawn as point sprites. The sprite is a gaussian core with a faint halo out to 3× the core, and the halo only shows for V < 2.
- **Brightness:** alpha = `clamp(0.25, (10^(−0.4·V) / 10^(−0.4·−1.5))^0.35, 1)`. Additive blending.
- **Colour** from B−V, warm-shifted to sit with the ivory/copper UI and never neon:

  | B−V | Colour | Look |
  |---|---|---|
  | ≤ −0.2 | `#B4C8FF` | desaturated blue-white |
  | 0.0 | `#EEF0F2` | white |
  | 0.4 | `#FFF1DD` | warm white |
  | 0.8 | `#FFDDB0` | cream |
  | 1.2 | `#FFC48C` | amber |
  | ≥ 1.6 | `#FFA86E` | orange |

  Interpolate linearly between rows.
- **Zoom behaviour:** as the FOV narrows, faint stars fade in. Sprite size stays constant on screen (it doesn't grow with zoom), so the sky doesn't turn into blobs.

**Milky Way**
- Only from a real all-sky image whose licence allows it. The SPHEREx DR1 all-sky HiPS at low order is the best fit (our own mission data). Map it onto the inside of the sphere.
- 40% opacity, multiplied by `#E9D8C2`, with saturation ×0.6 so it reads as a soft band.
- If no suitable texture is available, leave it out. Never paint one.

**SPHEREx detail layer** (Aladin or HiPS tiles, already built)
- Fades in as the FOV drops below **20°**: opacity ramps from 0 to 1 between 20° and 8°, while catalogue star sprites fade to 30% so the real survey pixels lead.
- The tile stretch is asinh, with a warm-grey colormap at low contrast. With "Paint the sky in my colour bands" on, each band's channels are tinted in its colour.
- Smooth tile interpolation while zoomed out; true pixels only below 1°.

**Overlays** (DOM on top of the canvas)
- Graticule: off by default, toggled from the tool rail. Lines `rgba(255,235,210,.08)`, equator `.20`, labels Plex Mono 11 px on dark pills.
- Constellation lines and names: **off** (not in the team list). If the team adds them later: `rgba(227,168,107,.18)`, 1 px.
- Target pins, search result, selection box and cursor reticle (section 19) are the same components as E+.
- Every text chip over the sky gets a dark pill (`rgba(21,17,14,.82)`), because the sky can be bright anywhere.

**Transitions**

| Trigger | Motion |
|---|---|
| Search / quick pick | Camera slerps to the target over **900 ms** (`cubic-bezier(.77,0,.175,1)`) while the FOV eases to 3°; the selection appears when it lands |
| Play this patch over time | FOV eases to the cutout's size (about 0.06°, 600 ms), then the existing View Transition morphs the selection box into the flip-book canvas (section 12) |
| Back to the sky | The reverse: canvas to box, then the FOV widens to 3° |
| Reduce motion | All of the above become instant cuts with a 150 ms cross-fade |

**Performance**
- One `THREE.Points` for the stars and one sphere for the Milky Way.
- **Render on demand** (only while the camera moves or a fade runs), so the canvas is idle when nothing moves. Pause when the tab is hidden.
- devicePixelRatio is capped at 2. Target 60 fps on an integrated GPU with the sky plus 4 glass layers.

**Accessibility**
- The canvas has `role="application"` and an aria-label: "Sky. Centre RA 17h 57m, Dec +4°. Field of view 3°." Update it (polite) after moves end.
- All actions can be done without the pointer: search, quick picks, keys, and Play.

## 19. Cursor and hover motion you can see

Nithil: "cursor tracking animations are not visible at all". The 10% glare is too faint on ivory glass. This section replaces it with feedback you can see.

**Sky cursor reticle** (sky scene, fine pointers only)
- **Shape:** a 28 px ring (1.5 px, `#E3A86B` at 75%) with four 6 px ticks, plus a coordinate tag 14 px right and 14 px below the pointer: Plex Mono 11 px `#EDE5DA` on a `rgba(21,17,14,.82)` pill.
- The system cursor becomes `crosshair` under it.
- **Follow:** spring-lerp toward the pointer at 0.32 per frame (rAF), so it trails slightly and you can see it move. Under Reduce motion it is pinned to the pointer.
- **Magnetic:** within 18 px of a named object, the reticle snaps to it, grows to 40 px over 160 ms, turns solid copper `#C27A43`, and the name tooltip appears (section 15).
- **Press:** the ring shrinks to 0.85 (90 ms). On release, a **ripple ring** (scale 1→2.4, opacity .6→0, 420 ms ease-out) marks the click point as the new selection. With sound on, it plays the tick.
- **Drag:** the reticle hides and the cursor becomes `grabbing`.
- Over UI glass (top bar, dock, panel) the reticle hides.

**Glass glare (all glass surfaces)**
- Visible but tasteful: `radial-gradient(240px circle at var(--gx) var(--gy), rgba(255,250,240,.38), rgba(255,250,240,0) 65%)` with `mix-blend-mode: soft-light`, eased at 0.18 per frame.
- Opacity 0 → 1 over 300 ms on pointer enter. Off with Reduce motion or Reduce transparency.

**Keys and controls** (hover only on `(hover:hover) and (pointer:fine)`)

| State | Look | Timing |
|---|---|---|
| Hover | `translateY(-1px)`, far shadow grows to `0 14px 24px -10px`, top highlight brighter (`inset 0 1px 0 #fff`) | 140 ms |
| Press | `translateY(1px) scale(.97)`, shadows collapse to inset `0 1px 3px` | 100 ms in, 160 ms out |
| Focus (keyboard) | 2.5 px copper ring, 3 px offset, always visible | – |
| Play knob, hover | Collar brightens: `0 0 0 4px #EADFD1` | – |
| Play knob, press | Dome dips: `scale(.95)` | – |

**Flip-book stage**
- `cursor: crosshair` over the image.
- Hovering the target ring raises the ring to full opacity and makes it 15% thicker, then the tooltip appears. The unidentified-source hit area shows a 1.5 px dashed `#F3CFA6` circle on hover.

**Scrubber**
- Hover: thumb `scale(1.06)`. Grab: `scale(1.14)`.
- On hover a **ghost tick** follows the pointer along the track: a 2 px `--copper` line at 40%, with a date pill above it (Plex Mono 11 px) showing which frame a click would jump to.
- Hovering a timeline tick shows "15 Mar 2026 · λ 4.37 µm · CO₂ Ice" with the band swatch.

**Proof of visibility:** at 1366×768, every hover state must be visible in a still screenshot. If a reviewer can't see it in the screenshot, it fails.

## 20. Sounds v2 (Nithil's changes)

Web Audio only, synthesised in code. Credits line: "UI sounds synthesised by AI-written code (Web Audio)".

**Rules:**
- Peak ≤ 0.063 (about −24 dBFS); every sound ≤ 120 ms.
- The AudioContext is created on the first pointer or key event.
- **Muted** when Clarity → Sound is off. Sound **defaults off** when the OS asks for reduced motion.
- No hover sounds, no loops, and no sound per frame during normal playback.

| Event | Recipe | Gain | Throttle |
|---|---|---|---|
| **Zoom in** (wheel, pinch, + key, zoom keys; sky and flip-book) | **New:** sine glide **420 → 680 Hz** over 90 ms, through a lowpass at 1800 Hz (Q 0.7), plus an "air" layer: white noise through a bandpass at 1200 Hz (Q 0.8), 70 ms | sine 0.030, air 0.010 | ≤ 1 per **150 ms** while scrolling continues |
| **Zoom out** | Same, gliding **680 → 420 Hz** | same | ≤ 1 per 150 ms |
| **Scrub tick** (dragging the scrubber, ←/→ steps; one per frame passed) | **New:** triangle 3200 Hz, 3 ms attack, 12 ms decay | **0.018** (quieter than click) | ≤ 1 per **35 ms**; frames passed faster than that are skipped silently |
| **Season crossing** (thumb or step enters a new season segment) | **New:** two-note chime, sine 880 Hz (55 ms) then 1320 Hz (65 ms), 50 ms apart | 0.040 when dragging or stepping; **0.020 during playback** (one soft chime as playback enters each season) | ≤ 1 per 250 ms |
| Key press, play/pause, toggles | click: triangle 1700 Hz 35 ms + sine 850 Hz 45 ms (unchanged) | 0.05 / 0.03 | 45 ms |
| View / speed switch, popover open | tick: sine 2400 Hz 25 ms (unchanged) | 0.04 | 45 ms |
| Results loaded, copied | confirm: sine 660 → 990 Hz (unchanged) | 0.055 / 0.05 | – |
| Error (incl. map failed) | triangle 240 → 190 Hz (unchanged) | 0.05 | 1 per state change |

Implementation note: give each event its own throttle clock (zoom, scrub, season, UI) so a scrub tick never swallows a season chime.

## 21. Errors and map-failed state

**Inline search error** (replaces raw red text under the search)
- A small glass message under the field: a 10 px coral dot, then plain words, then a recovery action as a ghost key.
- Wording by case:
  - unknown name: "Couldn't find “Barnads Star”." [Try Barnard's Star] (closest example match, if any) + "or type RA Dec in degrees like 269.45 +4.69";
  - out of range: "RA must be 0–360° and Dec −90 to +90°.";
  - archive busy: "The archive is busy. Try again in a moment." [Try again].
- The message is `role="alert"` and clears on the next input. **Never show library or stack text** (e.g. Aladin's "recursive use of an object…"). Log those to the console only.

**Map failed** (Aladin or WebGL can't start, tiles time out after 12 s, or a WASM error)
- A stage state over the sky area (same component as the flip-book's stage states):
  - Title: **"Sky map couldn't load"**.
  - Body: "Your browser couldn't start the sky view. The time-lapse doesn't need it."
  - Actions: **[Open time-lapse]** (primary copper: goes to the flip-book for the current target or search) and **[Try the map again]**.
- Error sound once.
- Search, quick picks and the details panel keep working: selecting a quick pick goes straight to the time-lapse.
- With no WebGL at all, show the same state with the body "This browser can't show the 3D sky."

**Empty / slow / error in the flip-book:** unchanged (sections 6 and 17). The live build's real retry count ("IRSA retrying: 3 images") replaces the countdown.

## 22. Build mapping (live `web/` → E components)

The live build uses E's own markup and CSS (`web/styles/e.css` plus `live.css`) and the E+ ids, so restyling means keeping these ids and classes and applying the fixes in the notes.

| Live element (id / class in `web/index.html`) | E component (section) | Notes / required changes |
|---|---|---|
| `.app[data-scene=map\|viewer]` | Scenes (12) | Map is the first scene |
| `nav.rail`, `.logo-slot`, `#aboutBtn` | Nav rail, logo (0, 5) | `<img class="logo-slot">` with the small cut of the symbol, 40 px (28 px in the phone top bar) |
| `header.topbar.glass.hero` · `.name` | Top bar (6) | `.name` shows "Star Shift"; the `<title>` starts with it too (not "SPHEREx Sky Viewer") |
| `form.search` · `#q` · `.key.primary` | Search (6) | Add the inline error message (21) |
| `.picks .key.pick` | Quick picks (6) | – |
| `.coords` · `#coordTxt` · `#copyTop` | Coordinates + copy (6) | – |
| `#clarityBtn` → `#clarity` | Clarity popover (9) | Add **Display** options (below) |
| `#helpBtn` → `#help` | Help/About popover | – |
| `#stage` · `#mapLayer` · `#mapWrap` | Sky (12 → 18) | Aladin now, three.js next; overlays get dark pills |
| `#pins .pin` · `#sel` · `.reticle` | Pins, selection, centre reticle (12) | Add the cursor reticle and ripple (19) |
| `#mapRead` · `#mapCredit` | Readout chip, credit (12) | Dark pill background (fix 2) |
| `#mapWl` · `#wl` · `#wlOut` | **Map colour slider** (built extra) | Accepted. Skeuo scrubber styling (fix 5) |
| `#tools` (`#mapBack #zin #zout #zfit #bandTool #ringTool`) | Tool rail (6) | Zoom plays the new glide sound (20) |
| `#screens #pan #cvA #cvB` · `#capA #capB` | Flip-book stage (5, 6) | Integer scaling (5) |
| `#hitStar #hitOther` · `#tip` | Star labels (15) | Hover ring states (19) |
| `#chip` · `#flag` | Wavelength chip, blink flag (6) | Chip dot shows the band colour (14) |
| `#stLoading` › `#scanLoader` · `#thin` | Astronaut loader (17), scan loader as fallback (17b) | `AstroLoader` draws the video, text, retry pill and Start key, with the same calls as `ScanLoader`; wait `done()` ms before hiding. `#thin` is the 2 px progress line after Start watching |
| `#stError` · `#errTxt` · `#retry` · `#useLoaded` · `#stEmpty` | Stage states (6) | Add the **map-failed** variant (21) |
| `#insp` · `#cdPanel` (`#cdPos #cdCov #cdMot #cdNear`) | Coordinate details panel (13) | Velocity rows accepted: Speed across sky = COMPUTED, Radial velocity = CATALOGUE (SIMBAD) |
| `#obsSw` · `#obsBody` | Observer (16) | Privacy line must stay visible |
| viewer `.insp-sec` (`#d-date … #d-meas`) | "This image" panel (6) | – |
| `#dock` · `.map-dock` (`#mdCursor #mdFov #mdSel #mdPlay`) | Dock, map scene (12) | – |
| `.transport #prev #play #next #counter` | Player (6) | – |
| `#track` · `#tlLabels` · `#seasonLbl` | Season scrubber (6, 19) | Ghost tick + scrub sounds (19, 20) |
| `#viewSeg` (Time/Compare/Blink) | View switch (6) | Built. Compare/Blink need two seasons, with a toast otherwise (accepted) |
| `#speedSeg` | Speed | – |
| `#flagsBtn` | Layers: FLAGS | – |
| `#bands` (`#ruler #detRow #scaleRow #lanes #rows #addRange #resetRanges`) | Band editor (14) | **Fix the row layout** (fix 1); descriptions under the inputs |
| `#mapBandsSw` | "Paint the sky in my colour bands" (built extra) | Accepted; switch at the top of the band editor |
| `#strSeg` · `#rampSeg` | Clarity → Image | – |
| Footer / credit lines | Credits (8, 9) | Copper links (fix 3) + the sound credit |

**Display options:** wherever they exist in a build, all of them must stay reachable:
- Field of view 3′ / 10′ / 20′;
- Wavelength band (All / Band 1–6);
- Brightness scale (Linear / Asinh / Log);
- Pixels (Smooth / True);
- Frames to load (60 / 120 / All);
- Copy link to this view.

In E they live in **Clarity → Image** as segmented controls, with "Copy link to this view" as a key at the bottom of Clarity.

**Band colours** (Nithil, decided):

| Band | Range (µm) | Colour |
|---|---|---|
| Starlight | 0.74–1.11 | `#5B8CFF` |
| Cool Stars | 1.11–1.64 | `#3FC1C9` |
| Through the Dust | 1.64–2.42 | `#7BD389` |
| Water Ice | 2.42–3.82 | `#F2C14E` |
| CO₂ Ice | 3.82–4.42 | `#F28C38` |
| Brown Dwarfs | 4.42–5.01 | `#E5484D` |

- These are **data colours**: swatches, ruler bands, timeline ticks, the chip dot and map tint only.
- Never use them as text colour on ivory.
- The band name is always written next to its swatch.

# Team features 2 (v3.2): sections 23–24

From the team's new ideas (Nithil, Sat 14 Nov ~21:30): "Contamination flagging - air glow, cosmic rays, light scatter due to space dust, pixel overflow" and "Ghost - future predictions of stars, location". Written Sat 21:32, short on purpose so Coding can build tonight. Planetarium, Observation Archive and Spectral Explorer specs follow later. Kurucharan's reference board is a layout reference only: no "SPHEREx Observatory" logo or NASA branding; the app is Star Shift.

## 23. Contamination flags and the Layers bar (team feature B)

**Layers bar** (the existing "Layers" group in the dock; same `.key` look)
- One segmented control picks **what the stage shows**, one at a time: `IMAGE` · `VARIANCE` · `ZODI` · `WAVE`. Then, separated by a hairline, one toggle key **`FLAGS ▾`** that draws on top of any of them.
- Plain-language titles (tooltip and `aria-label`): IMAGE "the picture itself"; VARIANCE "how uncertain each pixel is"; ZODI "glow from dust in our Solar System (the archive's model)"; WAVE "the wavelength each pixel was measured at"; FLAGS "pixels the archive marked as contaminated".
- **A layer the cutout does not carry is disabled**, title "Not in this cutout". Never draw a made-up layer. Drop a key entirely if Coding cannot get that layer at all.
- The choice holds while the flip-book plays, and applies to both sides in Compare and Blink.
- Switching: 120 ms cross-fade (instant with Reduce motion), the existing `click` sound.
- Phone: the bar scrolls sideways in one row; keys stay 44 px tall.

**The three extra views** (same grid, same whole-pixel scaling as IMAGE)
- VARIANCE and ZODI use the copper image scale (`R` ramp `copper`), so they cannot be mistaken for the picture. WAVE colours each pixel by the user's colour band it falls in (the six band colours, section 14).
- The stage chip leads with the view: `VARIANCE · λ 4.93 µm · D6 · 15 Aug 2025`.
- A small legend sits bottom-left of the stage (mono 11 px on the dark pill): a 120 px ramp with its low and high values and unit. For WAVE it is the band swatches with names.
- Tags in the info panel: IMAGE, VARIANCE, FLAGS, WAVE = `OBSERVED` (they come from the archive file). ZODI = `COMPUTED`, with the line "Model made by the archive, not a measurement".

**Flag marks** (drawn per pixel, on top)
- One colour for every flag: ivory `#FFF6E8` strokes, 1.5 px, with a 1 px `rgba(11,9,7,.8)` under-stroke so they read on bright and dark pixels. **Shape tells the kind, not colour**, so it works for colour-blind viewers and never clashes with the band colours.

| Kind (plain name) | Mark in the pixel | Team's words |
|---|---|---|
| No data | the existing diagonal hatch (`--mask-bg` / `--mask-ink`), unchanged | – |
| Signal jump (cosmic ray or bright star) | a small × in the pixel's top-left corner | "cosmic rays" |
| Pixel overflow (too bright) | a filled triangle in the top-right corner | "pixel overflow" |
| Scattered light | three dots along the diagonal | "light scatter" |
| Airglow | one wave line along the top edge of the image (it is a whole-image value in the file, not a pixel flag) | "air glow" |
| Other flag | a thin square outline | – |

- **Show a kind only if Coding can map it to real bits in the archive's flag mask.** A kind with no real bit behind it is left out of the legend, not faked. Dust glow is a smooth layer, not a pixel flag: the legend says "Dust glow is the ZODI layer" with a link that switches the view.
- A pixel with several flags shows the first kind in the table order plus a 2 px dot in its bottom-left corner. Hover or tap lists them all in the pixel tooltip ("Cosmic ray hit · Pixel overflow").
- Below 10 px per pixel the shapes are unreadable: draw every flagged pixel as the thin outline only, and let the legend carry the detail.
- **Marks never cover the middle of a pixel.** Each mark sits in a corner and takes at most a third of the pixel, 1.25 px, ivory at 85%, so the pixel's own brightness stays readable.
- **Blocks:** when six or more touching pixels carry the same kind, draw one outline around the whole block (1.5 px ivory with the dark under-stroke) and a single mark in its top-left pixel, not a mark in every pixel. On a bright star the archive flags the star itself in nearly every image; the star must stay visible.
- **Name the flag for what it is.** The build maps the archive's TRANSIENT, SNOWBALL and HALO bits to the × kind. On Barnard's Star that kind covers a block of about 60 pixels on the star in 119 of 120 images, which a particle hit cannot do. So the legend reads "Signal jump (cosmic ray or bright star)" with the meaning "The signal jumped during the exposure. Usually a particle hit; on a very bright star the star itself sets it off." Never "a particle hit the detector" as a plain fact.

**As built (accepted, Sat 21:54)**
- A flagged pixel that is also no-data shows its mark over the hatch.
- "Other flag" starts switched off (about 70 per image would bury the picture).
- `FLAGS` and `▾` are two joined keys: the first toggles the overlay, the second opens the legend.
- The legend has a second, **collapsed** part: "Hide images where these touch the star", one checkbox per kind with its count.
- The legend popover is never taller than the stage (`max-height: min(520px, stage height − 16px)`, scrolling inside) and never covers the top bar. Esc and a second press of `▾` close it.

**Legend and filter** (glass popover from `FLAGS ▾`, 280 px; a bottom sheet on phone)
- One row per kind present in the data: the mark · the plain name · a one-line meaning · the count in this image · a switch to show or hide it.
- Footer: "Flags come from the archive's own quality mask for each image."
- Empty: "No flagged pixels in this image."

**Info panel, "This image":** the row "No-data pixels 15 of 625" becomes "Flagged pixels 23 of 625", `OBSERVED`, with the same breakdown on hover.

## 24. The Ghost: predicted past and future position (team feature C)

**What it is:** a marker for where the star was or will be on a date the viewer picks. The existing dashed copper ring keeps its job (where it should be on *this image's* date); the Ghost is the same sum run for another date.

**Drawing** (on the stage, above the image, below the labels)
- The Ghost is a **hollow ivory ring** (`#FFF6E8` at 80%, 1.5 px solid, same radius as the dashed ring) with a soft 6 px ivory halo at 18%. Never a filled dot or a copy of the star: it must not look like data.
- A **dotted ivory trail** (1 px, 2-4 dash) runs from the dashed ring to the Ghost, with a small tick every year, decade or century (whichever gives 3 to 12 ticks).
- A mono label beside it: `2051 · +25 yr`.
- When the Ghost is outside the picture: a chip pinned to the nearest stage edge with an arrow, `off the image · 4′ 20″ NNE`.
- If the catalogue gives an error on the motion, the ring's radius grows with it (never smaller than one pixel). If not, keep the fixed radius and say so in the caption.

**Control**
- A **Ghost key** in the stage tool rail, under the ring key (`.glass-btn`, icon: a dotted circle with a small arrow), `aria-pressed`.
- On: a glass slider strip appears along the bottom of the stage, inside it: `−50 yr` ——●—— `+50 yr`, a centre detent at the image's date, a mono readout (`2051 · +25 yr · moved 4′ 20″`) and a **Reset** key.
- **Range:** ±50 years by default. If the star moves less than one pixel (6.15″) in 50 years, step the range up to ±500, then ±5,000 years, and print the range on the ends of the slider so the scale is never hidden.
- Keyboard: arrows move one step, Shift + arrows ten, Home returns to the image's date.
- The Ghost follows the slider directly, with no easing lag. It fades in over 180 ms when switched on (instant with Reduce motion). The slider plays the soft scrub tick (section 20), throttled.
- Phone: the strip is full width at the bottom of the stage and the readout sits above it.

**Honesty**
- Tag `COMPUTED`. Caption in the info panel under "Where it should be": "Ghost: predicted from the catalogue's proper motion in a straight line. It leaves out the yearly parallax wobble and any change in speed."
- Two new rows there: "Ghost date" and "Moved since this image", both `COMPUTED`.
- No catalogued motion: the Ghost key is disabled, title "No catalogued motion for this object".
- The time-lapse itself never changes: the Ghost is an overlay, and it is off by default.

**For Coding:** the class `.ghost` is already taken by the scrubber's hover tick (section 19). Use other names here, for example `#ghostKey`, `#ghostBar` and `.gh-*`.

**As built (accepted, Sat 21:54)**
- The Ghost draws in Time view only, in a straight line, with a fixed-size ring; the caption says the catalogue errors are not drawn.
- The Ghost's label flips to the other side of the ring when it would cross the stage edge, and the off-image chip sits 10 px inside the image edge.

# Team features 3 (v3.3): sections 25–30

Written Sat 21:43 for the team's new ideas (Nithil, Sat ~21:30) and the Master Session's work order 7. Short specs, text only, no prototype. **The build decides what exists; these sections decide how it looks.** Anything the data cannot support is left out, not faked. Kurucharan's reference board is a layout reference only: no "SPHEREx Observatory" logo, no NASA branding.

## 25. Pages, navigation and shared rules for the new pages

**Navigation**
- The nav rail lists the pages that are built, each a `.nav-btn` (20 px line icon + a 12 px label of at most 10 letters): **Viewer** · **Archive** · **Spectrum** · **Near-Earth** · **Orbits** · **Spot** · **Proof**, then at the foot of the rail **Tonight?** · **About**. A page that is not built gets no button. No underlines on rail labels; the same names and order on every page.
- **As built (Sat 22:56):** the rail is Viewer · Archive · Spectrum · Proof · Asteroids · Spot, then at the foot Tonight? · Notebook · Help · About. Ten is the limit. "Asteroids" is the label for the asteroid page: never "Spotter" beside "Spot".
- **The rail must fit a real laptop window** (1366 wide, about 640 tall once the browser's own bars are counted). It scrolls inside itself when it does not fit, and under 700 px tall the foot group folds into one **More** key that opens the Pages sheet. Nothing is ever cut off.
- Phone (the rail is hidden): a **Pages** key in the top bar opens a glass sheet with the same list.
- The current page has `aria-current="page"`. Changing page keeps the selected object.
- How the reference board's names map: Sky Explorer = the sky map (12, 18); Temporal Analysis = the flip-book viewer (6); Source Inspector = the coordinate details panel (13). Investigation, Findings and Methodology have no spec yet.

**Every new page uses the same shell and parts**
- Rail, top bar and Clarity panel as now. Plots and sky go on the **dark flat stage**; tables, details and controls go on the **ivory shell** (`.well` panels, `.key` buttons, glass only on floating layers).
- Type: Instrument Sans for words, IBM Plex Mono with tabular figures for every number. No new fonts, colours, shadows or radii.
- **Every number has a unit and a source tag.** Tags: `OBSERVED`, `COMPUTED`, `CATALOGUE`, and one new tag **`JPL`** (styled like `CATALOGUE`) for values from JPL services.
- Missing values show "—" with the reason on hover. Never 0, never a guess.
- **When every row in a group has the same tag, show the tag once in the group heading**, not on every row (as "This image · OBSERVED" does in the viewer).
- Sky coordinates use the app's own format everywhere (`17h 57m 47.1s`, `+04° 46′ 06″`), with decimal degrees second if needed.
- **Type is never under 11 px**, tags and badges included, and tag text meets 4.5:1 on its own fill. On phone every key, switch, pin and disclosure is at least 44 px in its smaller dimension.
- Every page has one `<h1>` (the page title; on the Viewer, the name) and every icon-only key has an `aria-label`.
- Loading, empty and failed states follow section 21. Clarity settings (Reduce motion, contrast, text size) apply everywhere, and **every page has the Clarity key in its top bar, and the Pages key on phone**.
- An object's position reads the same on every page, or says which one it is ("Catalogue position, J2000" or "Position now"). Keys are 44 px tall on phone, with a visible focus ring.

**Charts** (Spectrum, Near-Earth, Orbits)
- On the dark stage: axes and labels in `--stage-muted`, Plex Mono 11 px; gridlines `rgba(255,235,210,.08)`, 1 px; no 3D, no gradients, no drop shadows.
- The six band colours (14) mean wavelength and nothing else. Other data uses at most four series: ivory `#FFF6E8`, copper `#E3A86B`, sage `#9DB8A0`, warm grey `#B5A898`. Each series also differs by marker shape or dash, so colour is never the only cue.
- Hover or tap a point for a mono tooltip (value, unit, date, source). Selected point: filled; others: hollow.

**Tables** (Archive, Near-Earth, Orbits)
- On a `.well` panel: 36 px rows, hairline rules, no zebra stripes, sticky header, numbers right-aligned in Plex Mono.
- Click a header to sort (arrow shows direction, `aria-sort`). The selected row gets a 3 px copper bar on its left edge.
- Phone: each row becomes a two-line card.

## 26. Planetarium view, "Can I see it tonight?" (team feature)

**Name (team decision via the Master Session, Sat ~22:05):** the rail label is **Tonight?** and the page title is **Can I see it tonight?**. It sits at the foot of the rail, below the data pages. Where this file says "Sky now" it means this page.

Team's words: "Live location based sky and all the asteroids moon and suns and planets whatever we can see - option to take the night sky of major laboratories also and NASA centers also and enter coordinates to located that sky too".

**What it is:** the 3D sky (18) seen from a place on Earth at a chosen time.

**Sky**
- A horizon line (1 px ivory at 40%) with N, E, S, W in mono. Below it, a flat `#1B1612` ground at full opacity. No landscape art.
- It opens facing south (north for southern places), tilted 40° up. Drag to look around, as in 18.
- **Daytime is said, not painted:** when the Sun is up at that place and time, a chip reads "Daytime here: the stars are in these positions but cannot be seen". The sky stays dark.

**Place** (a glass bar at the top-left of the stage: "From: Colombo ▾")
- It opens a popover with four tabs: **My location** · **Observatories** · **NASA centres** · **Coordinates**.
- My location follows section 16 exactly: off until asked, kept in memory only, with the same privacy line.
- Observatories and NASA centres are plain-text lists from the build (name, country, latitude, longitude). **No logos or insignia**, names only.
- Coordinates: `lat, long` in degrees, with the section 16 error wording.

**Time** (in the dock)
- "Now" by default, refreshed once a minute, not animated. Shown as the place's local time and UTC.
- A slider of ±12 hours and a date field. A **Now** key returns.

**Solar System objects**

| Object | Mark | Label |
|---|---|---|
| Sun | ivory disc with a thin ring | "Sun" |
| Moon | disc with its real phase drawn as two arcs | "Moon · 62% lit" |
| Planets | filled ivory disc, 6 px | the name |
| Asteroids | hollow diamond, 6 px | the name or number |

- Marks are not to scale; the caption says so. Names and positions carry the `JPL` tag when they come from JPL. Show the objects the build really has.
- Objects below the horizon are hidden. A switch "Show below the horizon" draws them at 35%.
- Selecting an object opens the details panel (13) with: altitude and azimuth now, rise, highest, set, distance and brightness when given, each with its tag.
- "Play this patch over time" shows only for objects the time-lapse can really handle. Hide it for the rest.
- **The page answers its own title.** Arriving with an object (from the Viewer, or `?q=`), it selects that object, turns the sky to it, and shows an answer card at the top of the details panel: "**Yes**, tonight from Colombo: up 18:40 to 23:10, highest 52° at 19:55", "**No**: it stays below the horizon tonight from here", or "**Only in daylight** tonight". A fourth wording, as built: "**Not any more tonight**: it set at 20:37", followed by tomorrow night's times. `COMPUTED`, from the rise and set times already worked out. With no object, the card reads "Pick something to see if it is up tonight".

**Phone:** the place bar is full width; time moves into the dock sheet. **Reduce motion:** time never advances by itself, and the view jumps without a glide.

**As built (accepted, Sat 21:59)**
- The ±12 hour slider keeps a play key with three speeds (1 min/s, 10 min/s, 1 h/s). It only runs when pressed and is switched off under Reduce motion.
- Typed coordinates have no known time zone, so their clock is labelled "Solar time".
- Stars are flat dots; the brightest get a halo. The halo is a soft radial fade (35% to 0), never a flat disc, so it cannot be mistaken for a selection ring. Only Solar System objects are solid discs.
- The sky stops at the left edge of the details panel. There is no Milky Way in this view. A star's distance shows "—" with the reason.
- Sun, Moon and planets are worked out in the browser, so they are tagged `COMPUTED`, not `JPL`.
- A planet's label wins over star names: star names within 24 px of it are hidden.
- On phone the dock shows the chosen time as local and UTC, since the top-bar clocks are hidden there. The date field has a written label.

## 27. Motion panel (team feature K)

Team's word: "Velocity". Master: angular, proper and orbital velocity, each with its source.

It is the **Motion** group of the coordinate details panel (`#cdMot`), opened up. One row per quantity: plain name · value in mono · unit · source tag · a small "how" line on demand.

| Row | Unit | Tag | Shown when |
|---|---|---|---|
| Proper motion (total, and its direction as an angle) | mas/yr, ° | `CATALOGUE` | the catalogue has it |
| Proper motion, east and north parts | mas/yr | `CATALOGUE` | same |
| Angular speed across the sky | ″/yr, plus "1 pixel every N years" | `COMPUTED` | proper motion exists |
| Speed across the sky | km/s | `COMPUTED` | proper motion and a distance exist |
| Radial velocity, with "toward us" or "away from us" | km/s | `CATALOGUE` | the catalogue has it |
| Speed through space | km/s | `COMPUTED` | both speeds above exist |
| Orbital velocity (Solar System objects) | km/s | `JPL` | JPL gives it |
| Measured in these images | ″/yr ± error | `OBSERVED` | the fit is final (the existing "Measured motion") |

- A row whose inputs are missing is left out, except the first: "No catalogued motion for this object".
- When both exist, one line compares them: "Catalogue 10.39″/yr · measured here 10.1 ± 0.6″/yr".
- **Direction dial** (64 px, in a well): north up, east left, an ivory arrow pointing where the object moves, labelled with the angle. The arrow has a fixed length; the number carries the size.
- Every row has the section 13 copy key. Solar System objects use ″/hour for angular speed.

**As built (accepted, Sat 22:15)**
- Extra rows: Parallax (`CATALOGUE`), Distance (`COMPUTED`), and "Speed across the sky, from the measured motion".
- Galactic U, V, W (two rows) are specialist values: they sit inside a closed **More detail** disclosure with "How these are worked out", so the panel opens short.
- The measured row says how many images it used ("from 108 images"), since the number moves as images load or are filtered out.

## 28. Observation Archive (team feature)

**What it is:** a table of every SPHEREx image of the selected patch, from the archive's own list.

- **Columns:** thumbnail (the real 25×25 image at 50 px, crisp, same stretch as the viewer) · # · Date (UTC) · Time · Season · Detector · Wavelength (µm, with its band swatch and name) · Flagged pixels · Status (Loaded / Waiting / Failed).
- **Filters** above the table, as `.key` chips: season, band, detector, "has flags". They combine. A count shows the result: "41 of 120 images".
- **Row click** opens that image in the viewer and moves the timeline to it; the row stays selected when coming back.
- **Footer:** "120 images · 3 seasons · 0.75–5.00 µm · Images: NASA SPHEREx via IRSA". A "Download list (CSV)" key only if the build has it.
- States: loading rows show a 1-line skeleton in the well colour; failed rows keep their place with "Failed · Retry"; empty: "The archive has no images of this patch yet".
- Follows the table rules in 25.

**As built (accepted, Sat 22:07)**
- Extra columns from the archive's list: MJD, Observation ID, Release; a Links column (FITS, Play); a search box for an observation ID or date; paging at 50, 100 or 250 rows.
- Thumbnails load for the rows on screen. Rows are 57 px tall so the thumbnail stays at a whole-pixel 50 px.
- Wavelength shows the detector's range until the image is loaded, then the wavelength at the star, as the viewer does.
- Phone: rows are cards. The filters sit behind one **Filters** key that opens a sheet, with the active filters shown as chips, so the first images are on the first screen.

## 29. Spectral Explorer (team feature)

**What it is:** brightness against wavelength for the selected object, one point per image.

- **Chart on the stage:** x = wavelength, 0.74–5.01 µm, linear; y = the brightness the build measures, with its unit. Each image is one dot in **its band colour**. The six bands sit behind as faint spans with their names, like the loader's ruler (17b).
- Error bars come from the VARIANCE layer when it exists. A flagged measurement is drawn hollow. A missing one is not drawn.
- Hover or tap a dot: date, detector, wavelength, value. Click opens that image in the viewer.
- **Controls** (ivory shell, right): which pixels are measured (the options the build offers) · seasons (All, or one line per season in the four series colours) · y scale Linear / Log.
- **Caption, always visible, tagged `COMPUTED`:** one plain sentence saying exactly how the brightness was measured and what was not done (for example "background not removed"). Coding writes it to match the code.
- No lines drawn between points unless they are a real fit. No spectral-feature markers unless the team asks for them.
- Phone: the chart is full width, 220 px tall; controls go in a sheet. Follows the chart rules in 25.

**As built (accepted, Sat 22:07)**
- Colour is the band; **marker shape is the season** (circle, square, triangle). This replaces "one line per season in the four series colours".
- Detector ranges (D1–D6) are drawn as bars under the wavelength axis.
- No error bars: the VARIANCE layer is not fetched. The caption says so, and the background scatter is in the CSV.
- **Ice guide lines are allowed** (H₂O ice 3.05 µm, CO₂ ice 4.27 µm) because the team's own bands are named for them, on one condition: a line under the chart reads "Guide lines show where these ices absorb. They are not detections."
- When nearly every dot is hollow, say why in one line: "Every measurement here includes flagged pixels: this star is bright enough to trip the archive's flags. Treat the values as rough."
- The key for hollow dots and season shapes sits directly under the chart, not only in the side panel.

## 30. Style notes for Codex's pages: I (near-Earth-object dashboard) and J (orbit comparison)

Codex builds these two from this file. They follow section 25 in full. These notes add what is special to each.

**I. Near-Earth objects** (the team's title: "Astronomical Threat Intelligence System")
- **Tone: serious and calm.** No red banners, flashing, countdown clocks, sirens, skull or impact imagery, and no words like "danger" or "doomsday". Suggestion for the team: use "Near-Earth objects" as the nav label and page heading, and keep the long title as a subtitle, since "threat" reads as alarm.
- **Torino scale:** a chip with the number and its official words ("0 · No hazard"), in the scale's own colour (0 white, 1 green, 2–4 yellow, 5–7 orange, 8–10 red). These colours appear only inside the chip.
- **Palermo scale:** the signed number in mono with a one-line meaning beside it (the wording from the source).
- **Distance:** lunar distances first ("12.4 LD"), kilometres second. One horizontal strip on the stage, log scale: Earth at the left edge, the Moon marked at 1 LD, each object a tick with its name.
- Size is a number in metres. No comparisons to cities or weapons.
- **Source and freshness, always visible:** "Data: NASA/JPL (CNEOS) · fetched 21:40", tag `JPL`. If the data is older than a day, say so in plain words. Text credit only, no logos.
- The list is a table (25), sorted by the date of closest approach. No sound beyond the usual clicks; nothing moves by itself.

**As built: the asteroid page (`neo.html`), reviewed Sat 22:56.** It must sit in the same shell as every other page:
- The top bar reads "Star Shift" with the AI mark, and has the shared Clarity key and, on phone, the Pages key. The rail is the shared rail.
- The page title is 22 px like every other page, not a display headline.
- **Name:** "Asteroid Spotter", not "SPHEREx Asteroid Spotter" (the mission's name is never part of a product or page name).
- **No "Caught by SPHEREx".** The table lists objects JPL *predicts* inside the field, not detections, so the section is "Predicted in this field", with one line under it: "Predicted positions from JPL, not detections. Brightness is shown so you can judge whether SPHEREx could see it."
- Counts and labels follow section 25: nothing under 11 px, 4.5:1 contrast, coordinates in the app's format, 44 px keys and fields on phone.

**J. Orbit comparison**
- **Orbit plot** (stage): seen from above the Solar System. The Sun is an ivory dot at the centre; planet orbits are 1 px lines at 25% ivory with mono labels; each selected object's orbit is 1.5 px in one of the four series colours with its own dash; today's positions are dots. A scale bar in au. Two captions: "Bodies not to scale" and "Tilt of the orbits is not shown".
- Zoom keys: **Inner system** and **Fit all**.
- **Scatter chart** (stage): two `.key` menus pick the x and y fields from what the build has, each with a Linear / Log switch. Points are hollow ivory circles; selected ones are filled in their series colour. No trend line unless it is really computed.
- **Table** (shell): selecting a row (up to four) gives it a colour chip, and the same colour and dash mark it in both charts.
- All values tagged `JPL` or `COMPUTED`.

## 31. Ground vs Space (item L)

From the Master Session, Sat 22:09. Two parts. The one-glance message: **geography and air limit what ground telescopes can see at these wavelengths; a telescope in space sees the whole range.** Say only that. Never "space has no limits": every telescope has its own.

### 31a. Telescope compare (in the time-lapse)

- A fourth choice in the view control: `Time` · `Compare` · `Blink` · **`Telescopes`**.
- **Three panels side by side** on the stage (stacked on phone), all showing the same patch, north up, at the same sky scale: SPHEREx, WISE/unWISE, 2MASS. A survey with no image of this patch shows "No image of this patch", never a blank or a stand-in.
- **Each image keeps its own pixels**, drawn crisp, not smoothed and not resampled to match. The difference in pixel size is part of the point.
- **Caption under each panel** (mono 11 px, from that survey's own metadata): name · a `SPACE` or `GROUND` chip · the site for ground images · date · wavelength band · pixel scale.
- The `SPACE` and `GROUND` chips are the same neutral outline chip. No green and red, no ticks and crosses: the pictures and captions make the case.
- The SPHEREx panel follows the flip-book; the other two are single survey images and say so ("one image, 1998").
- **Target ring and Ghost trail:** each panel draws the dashed ring where the star should be on *that image's* date. One dotted trail (24) runs through all three positions with a year tick at each, so the star's shift between surveys is visible.
- One line above the panels, always shown: "These are different wavelengths and different cameras. Compare where things are, not how bright they look." Each panel is stretched on its own.
- Tags: the images are `OBSERVED`; rings and trail are `COMPUTED`.

### 31b. Atmosphere lens (in "Sky now")

- A panel on the ivory shell, titled "What gets through the air". One row per place: the chosen place first, then up to three more sites from the place list, and a last row **"SPHEREx, in space"**.
- **Each row:** the place name and its height above sea level · the 0.74–5.01 µm ruler (the same ruler as 17b and 29) · on the right, the target from there now.
- **Ruler shading:** where the air lets light through, the ruler is clear; where it blocks it, the ruler carries the no-data hatch (`--mask-bg` / `--mask-ink`), and in between it darkens in proportion. The SPHEREx row is clear from end to end, with the caption "No air in the way".
- **The six default bands** sit above each ruler as swatch and name. A band the air blocks from that place gets a struck-through name and the word "blocked"; a partly open one says "partly". Words and strike-through, not colour alone. The rule for "blocked" is one number Coding picks and prints under the panel (for example "blocked = under 20% gets through, on average").
- **Target now** (mono, `COMPUTED`): "Up · 54° high · airmass 1.24", or "Below the horizon". The space row shows no airmass.
- **Source line, always visible:** which transmission model or dataset the shading uses, and "Typical clear night for this height. Real nights change with water vapour." Tag `COMPUTED`. If there is no curve for a place, leave that row out.
- Phone: rows stack, each ruler full width, band names shorten to swatches with a tap for the name.
- Follows section 25 (tags, numbers in mono, Clarity). No logos of observatories or agencies; names only.

**As built (accepted, Sat 23:10)**
- 31a: SPHEREx, AllWISE (2010) and 2MASS (2000, Mt Hopkins), each 410″ across, north up, same scale. The ring on each image's own date is copper; one trail carries the 2000, 2010 and 2025 ticks. Hatching marks sky outside an image.
- 31a layout: the panels fill the stage width (about 275 px each at 1366 px); the "Each panel…" line flows after the captions, never over them; dates use the app's format. On phone the panels stack, the view has bottom padding the height of the tool strip, and the compass is hidden (every caption says north up).
- 31b: shading from the Gemini ATRAN curves; a band reads "blocked" under 20%, "partly" from 20 to 80%, open at 80% or more, averaged across the band looking straight up. 0.74–0.90 µm has no curve and is drawn as no data.
- **Averages hide the gaps, so each ground row also lists where it is dark:** one line, "Dark from here: 2.5–2.9 µm, 4.2–4.4 µm" (the ranges where under 5% gets through, read from the curve). The SPHEREx row reads "Dark from here: nowhere".
- **A borrowed curve is only shown for a place at a similar height.** For a low place (Colombo, 5 m) a mountain curve is an upper limit: the row says "Best case: this is a mountain curve from 2,700 m. At sea level less gets through.", and its numbers read "at most 47%".
- The six band labels sit in six fixed columns so the rows line up and can be compared.
- Confirmed live, Sat 23:18: "Best case" applies to any place more than 1,000 m below its curve (Colombo, the NASA centres, typed coordinates), with "at most N%"; "Dark from here" lists the ranges under 5%, "even in this best case" on those rows and "nowhere" for SPHEREx.

## 32. "How we know": the validation page

From the Master Session, Sat 22:12. Judges score Validity here, so the page must be plain, complete and checkable. It follows section 25. Nav label: **Proof**; page heading: **How we know**.

**Opening line** (one sentence, 18 px): "For five well-known objects, we compare what the catalogues say should happen with what we measure in the SPHEREx images."

**The table** (on a `.well`, table rules of 25), one row per target: Barnard's Star, Epsilon Indi B, WISE 0855−0714, RW Aurigae, R Draconis.

| Column | Content |
|---|---|
| Object | name, and what kind of test it is: "moves" or "changes brightness" |
| Expected | the catalogue value with its unit: proper motion, or a variable's known period or amplitude. Tag `CATALOGUE`, with the catalogue's name (Gaia, SIMBAD) |
| Measured here | our value **± its uncertainty**, same unit. Tag `OBSERVED` |
| Difference | measured minus expected, and how many uncertainties that is ("0.4 σ") |
| Verdict | one chip, see below |
| Honest limits | one plain sentence per row on what stands in the way. Coding writes it from the real measurement (the kind of thing meant: "faint: only shows in the two longest bands", "the core is saturated, so the centre is uncertain") |

- **Verdict chips**, by wording and outline style, never by colour alone: **`AGREES`** (sage outline: within the uncertainty) · **`AT THE LIMIT`** (copper outline: measured, but the uncertainty is as large as the effect) · **`NOT MEASURABLE`** (grey dashed outline: with the reason in the limits column). No "FAIL", no ticks or crosses, no score out of five.
- **A row is never left out or softened because it looks bad.** A target we cannot measure stays in the table with `NOT MEASURABLE` and its reason. Missing numbers show "—".
- Each row opens to show its evidence: the small chart the number came from (positions over time with the fitted line, or the brightness curve), with a "Open in the viewer" link. Charts follow 25.
- Under the table, one line: how many images each result used, and the date the numbers were computed.

**Method** (a numbered list beside or under the table, four short steps, each one or two plain sentences, each with a "more" disclosure for the detail): 1 Lining up the images · 2 Finding the star's centre · 3 Fitting the motion or the brightness change · 4 Leaving out flagged pixels. Coding writes the sentences to match the code. No formula walls: one formula at most, in the disclosure.

**What this does not show** (a short list, always visible, same weight as Method): the limits that apply to every row, for example pixel size, number of seasons, no calibration across images.

**Credits** at the foot: the data and catalogue credits with their DOIs, as text. No logos.

**Tone:** measured and specific. No "proves", "confirms beyond doubt" or exclamation marks; say "agrees with", "within the uncertainty", "could not be measured".

**Phone:** each row becomes a card: object and verdict on the first line, expected and measured on the second, limits below.

**As built (accepted, Sat 22:33)**
- A fourth verdict, **`DIFFERS`** (double outline): more than 3 uncertainties from the catalogue, shown as measured with the likely reason. It is honest wording and stays.
- The rule for each verdict is printed on the page ("How each verdict is decided"). **It sits below the table, or closed above it: the table comes first**, so every verdict is on the first screen at 1366×768 and the first cards are on the first phone screen.
- Objects tested two ways (moves, changes brightness) get two rows.
- Brightness change is measured in two wavelength groups, and the row says which.
- The evidence chart may use the browser's own hover titles. Touch screens have no hover, so every number that matters is also written beside the chart (direction, seasons used, the value per detector group, and the value with flagged images hidden).
- "Honest limits" is the widest column; long notes show two lines and open with "more".

## 33. First-visit guided tour

From the Master Session, Sat 22:12. About six steps, about two minutes, calm.

**Behaviour**
- It is **offered, not forced**: on the first visit a small glass card at the bottom-right of the stage says "New here? Take a 2-minute tour" with **Start tour** and **Not now**. It never opens by itself over the content, and never appears again after either choice (remembered in the browser).
- **Help (the `?` key) has "Take the tour"** at the top, always.
- **Skip** is on every step, and Esc ends the tour. Ending it anywhere leaves the app exactly as the user had it, apart from what they did themselves.

**Each step**
- A glass card (max 320 px) placed next to the part it talks about, with a 2 px copper outline around that part. The rest of the screen is dimmed to 55%, never blurred, and stays readable.
- In the card: a step counter in mono ("3 of 6") · a title of at most five words · one or two plain sentences · **Back** · **Next** (copper primary) · **Skip**.
- The user can use the highlighted control during the step; the tour waits. It never clicks for them, except to open the panel a step needs.
- Phone: the card is a bottom sheet; the highlighted part scrolls into view above it.

**The steps** (Coding adjusts the wording to the build; a step whose feature is not built is dropped, and the counter shrinks)
1. **Five objects to start with:** the quick picks, and in one line each what to look for (which ones move, which ones change brightness).
2. **Watch it move:** play, and the timeline with its seasons.
3. **Blink:** flip between two dates to catch the shift.
4. **Flags:** what the marks on pixels mean and how to open the legend.
5. **Colour bands:** the six bands and how to change them.
6. **Your notebook:** the "+" that saves what you found. Only if the notebook is built.
7. **Spot a mover** (added after mock judging, Sat 14 Nov ~22:50): one card pointing at the Spot link that names the four moves, Spot → Verify → Explain → Record, in one sentence each at most. Only once the Spot page (34) is linked. It comes last, so the tour ends on what makes Star Shift different.
- A last card, not a step: "That's it. Help has this tour and the shortcuts." with **Done**.

**As built (accepted, Sat 22:47)**
- The pitch is its own intro card ("Welcome to Star Shift"), so the offer stays one line. The counter then runs "1 of 5" (or "of 6" once the notebook exists).
- Step 2 opens Barnard's Star for the user, and its card says so. Ending the tour after that leaves them in that time-lapse; it does not send them back to the map.
- The time-lapse the tour started is paused when the user leaves step 2, so the flags in step 4 hold still.
- In a private window, where nothing can be remembered, the offer does not show at all; Help still has the tour.
- The dim is a 45% dark overlay.
- **The offer never covers the main action.** On phone it is a single 56 px strip (text, **Tour**, a close key) under the top bar, not a sheet over "Play this patch over time". On desktop it sits clear of the map's credit strip.
- Step 4 names what is on screen now: hatched squares for no data, outlines and small marks for flagged pixels.

**Motion and sound**
- Cards fade and move 8 px (180 ms, ease-out); the outline moves between targets in 220 ms. With Reduce motion: instant.
- No confetti, badges, progress rewards, mascots or sounds beyond the usual click.
- Focus moves into each card and returns to where it was when the tour ends; the cards are announced to screen readers (`role="dialog"`, labelled by the title).

## 34. "Spot a mover": the citizen-science mode (item M)

From the Master Session, Sat 22:13 (Nithil said yes). The pitch it serves: "Every six months, NASA's SPHEREx photographs the whole sky. Star Shift lets anyone flip through those photos, catch what moved, and prove it's real." Calm and scientific. It follows section 25. Nav label: **Spot**.

**The flow is four numbered steps**, shown as a quiet stepper at the top of the stage (mono numbers, the current step in copper, done steps with their result in a few words). The user can go back to any step.

1. **Pick a field.** The sky map (12, 18) with one line: "Choose any patch. Nobody may have looked at it this way before." A "Surprise me" key picks a patch the archive covers in at least two seasons. A patch with one season says so and offers the nearest one with two.
2. **Blink.** The stage blinks the first season against the latest (the existing Blink, section 6), with the two dates shown. One line: "Look for a dot that jumps or appears. Click it."
3. **Click a suspect.** The click drops a copper ring with a number on that spot in both images. Up to five suspects per field; each can be removed.
4. **Verify.** A checklist runs by itself for the selected suspect, then a verdict card appears.

**Verify checklist** (a `.well` panel; each line shows a state, a plain result, and opens to its evidence)

| Check | Passing result reads | Evidence shown |
|---|---|---|
| Not a flagged pixel | "No archive flags on or next to this spot" | the pixel marks of 23 |
| Not a known star that moved | "No catalogued star whose motion puts it here" | the nearest catalogue stars, their motion and the predicted positions (24) |
| Not a known asteroid | "No known Solar System object here on these dates" | the JPL lookup result, tag `JPL` |
| Seen in at least two seasons | "Present in 2 of 3 seasons" | thumbnails of each season at that spot |

- States, by icon shape and word, not colour alone: **Checking…** · **Clear** · **Explained** (this check accounts for the suspect) · **Could not check** (with the reason, for example the lookup failed). A check that could not run is never shown as clear.
- Checks run in the table's order, one line at a time (about 300 ms apart, instant with Reduce motion), so the user sees the reasoning.

**Verdict card** (glass, beside the checklist; a title, two plain sentences, the deciding evidence)

| Verdict | When | Tone of the text |
|---|---|---|
| **Known star** | the catalogue motion explains it | "This is <name>, a star known to move this much. You found it by eye: that is exactly how it is done." |
| **Likely artefact** | flags explain it, or it is in one season only | "This is most likely not a real object. Here is why." |
| **Known asteroid** | the JPL lookup matches | "This is <name>, a known asteroid, passing through." |
| **Unexplained: worth reporting** | every check is clear | "None of our checks explains this. That does not make it a discovery, but it is worth a second look by people who do this for a living." |

- No verdict when a check could not run: the card reads "We could not finish checking" and says which check to retry.
- The words "discovered", "new planet" and "you found a new object" are never used. No confetti, badges, points, streaks, leaderboards or sounds beyond the usual click.

**How to report** (shown only with "Unexplained: worth reporting")
- Two plain-text options with what each is for: Backyard Worlds on Zooniverse (faint moving objects far beyond the planets) and the Minor Planet Center (asteroids and comets). Names as text links that open in a new tab. No logos.
- **A pre-filled summary** in a mono box with a **Copy** key: field centre (RA, Dec), the suspect's position in each image, dates, wavelengths, image IDs, which checks were clear, and "Made with Star Shift from NASA SPHEREx data via IRSA".
- **The app never sends anything itself**, and the summary holds nothing about the user. A line says so.
- The notebook "+" saves the suspect, its checks and the summary. Only if the notebook is built.

**Phone:** the stepper becomes "Step 2 of 4"; checklist and verdict are a bottom sheet.

**As built (accepted, Sat 23:15)**
- Step 1 has no sky map: the five targets, **Surprise me** and the search box pick the field. Each season is shown as the middle value of up to 40 images.
- Order of verdicts: Known star, then Known asteroid, then Likely artefact. A flag explains a suspect when it is on that spot in at least a third of a season's images and in at least two images; the check's evidence says so.
- A verdict may show while one check could not run, when another check already explains the suspect; the card names the check that did not run and says it would not change the answer. "Unexplained: worth reporting" still needs all four checks clear.
- Every verdict offers **Save to notebook**.

**Rules added after review (Sat 23:15)**
- **The verdict never waits on a slow lookup.** As soon as one check explains the suspect, the verdict shows, with "asteroid check still running" beside it. Checks that need no network (flags, known star, two seasons) run at once and do not queue behind JPL.
- **The JPL check may take up to 90 seconds** (Coding's measured figure: JPL answered in 50 to 75 s on Sat 14 Nov, so a shorter limit would nearly always fail). It shows the seconds passed while it runs, then "Could not check: JPL did not answer in 90 s" with **Retry**. This is acceptable only because the verdict no longer waits for it; "Unexplained: worth reporting" still needs it.
- **The verdict sits beside the image, not below the fold.** When it arrives it goes to the top of the right column; the four checks fold to one line each (state and plain result), opening for detail. The image column stays in view while the right column scrolls.
- Once a field is picked, the "Choose any patch" panel folds to one line ("Field: Barnard's Star · Change"), on desktop and phone.

## 35. As built in the viewer: Brightness over time, Clean blink, the thumbnail still

Built by Coding and reviewed on the live site, Sun 04:02. These three had no spec; this section records what is accepted and the rules that go with it.

**Brightness over time** (a closed disclosure in the info panel, tagged `OBSERVED`)
- Two rows, one per wavelength group; each dot is one image in its band colour; a white line marks each season's average; a copper playhead follows the player, and a click on the chart jumps the player.
- **Seasons side by side, each with its own time scale: accepted.** On one shared axis each few-week season is a vertical smear. The gaps between the three blocks carry a small axis-break mark (two short slanted strokes) and the caption keeps the sentence "the months between seasons are left out".
- Brighter is up, and the axis says so. The caption states what is plotted, what was skipped and why, and that the values are not calibrated.

**Clean blink** (a key that exists only in Blink view)
- It hides the overlays and zooms 3×; switching it off puts everything back exactly. The key reads "Clean blink: on" or "off" and carries `aria-pressed`.
- The compass and the scale bar stay. **One label also stays:** which season is on screen ("first season" or "last season", mono 11 px, ivory at 60%, bottom-left). Without it a recording of the blink cannot show which way time runs.

**Thumbnail still** (`evidence/still_barnard_1200x630.png`, made from real data by code)
- Headline in Instrument Sans, details in Plex Mono, on the stage colour, with the data credit. No AI imagery, so no watermark.
- **Colour exception, for this still only:** the three seasons are tinted copper, ivory and blue. Inside the app blue means the Starlight band and nothing else (section 25). The still may use it because its subtitle and legend say "colours = observing season" and the copper and blue edges are what make the motion visible at thumbnail size. Never tint seasons this way inside the app.
- Brand: add the Star Shift symbol on its ivory tile (the favicon art, 48 px) beside the "Star Shift" line, with the small AI mark, as the app's rail does.

**More as built in the viewer, reviewed Sun 04:04**
- **A band name is a range, not a claim.** On the stage chip, the timeline, the details panel and the loader caption a band reads "CO₂-ice band · 3.82–4.42 µm", with a tooltip that ends "Not a detection." On phone the chip drops the range; the info sheet keeps it. The band editor keeps the short names.
- **Blink shows one label:** the season, in the stage chip. The flag pill and the Compare captions are hidden in Blink.
- **Map to viewer:** the view changes at once and the images fill in behind a thin progress line. The full loader fades in only when the load is really long: decide 900 ms in, and show it only if the images still to come would take 2 s or more at the rate so far. A loader that appears for one second is a flash, not a help.
- **Notebook "+" keys** sit on the rows they save. They are at least 24 px on desktop and have a 44 px tap area on phone.
- Loader text (the astronaut caption, the scan loader's band names) is .75rem; the Design Studio's source CSS matches the live copies.
