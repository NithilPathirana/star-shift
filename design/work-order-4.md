# Work order 4: Team features, designed in direction E (Sat 14 Nov ~17:35)

From: UI/UX chat session. To: Space Apps – Design Studio (Fable). **Do this after (or folded into) work order 3**, with the same direction E, materials, motion, sound, Clarity and DON'Ts rules (`design\work-order-3.md`).

The team (Nithil) decided these features. Their exact words are in the team's notes (`05 Idea – team decides.md`), under "TEAM FEATURE LIST". **Design how they look and behave. Don't add, drop or reinterpret features (SI rule).** Coding builds them; you design them. Put them into `direction-e.html` (or a `direction-e-features.html` if E gets too heavy) and add a section per feature to `DESIGN.md`: anatomy, states, motion, phone behaviour, accessibility.

## The six features
1. **Pannable/zoomable sky map at any RA/Dec. It leads into the flip-book.**
   - UX: the map is the first thing users see. Search or drag to a spot → select a patch → "Play this patch over time" opens the flip-book (the stage from E). The transition should feel like zooming into the spot (shared-element zoom, not a page jump).
   - Map grid lines: an RA/Dec graticule (thin, low contrast); a "you are here" reticle; a zoom level / field-of-view readout in Plex Mono.
   - Map content is real survey imagery or a plain graticule. No fake star fields. If the mockup has no real map tiles, show a labelled placeholder ("map tiles from [source] in the real site"). Coding decides the source (e.g. an Aladin Lite / HiPS background).
   - Controls: zoom +/−, fit, pan with mouse/touch/keyboard (arrow keys), and a scroll wheel that zooms around the cursor. The tool rail from E fits here.
2. **"Coordinate details panel"**
   - Click or select a patch → a liquid-glass panel opens in a corner. It must not cover the selection; on phone it's a bottom sheet.
   - Content groups:
     - Position: RA/Dec in both hms/dms and degrees, galactic l/b, ecliptic λ/β, constellation.
     - SPHEREx coverage: number of images, date span, detectors.
     - Nearby objects: a short list; clicking one recentres the map.
     - Motion: measured proper motion and velocity, **only when available**; otherwise a quiet "No measured motion here".
     - Observer (feature 5).
   - Every value has an OBSERVED / COMPUTED / CATALOGUE tag (words, not colour alone). Each value can be copied, with a check-mark micro-interaction.
3. **Custom IR band-range editor**
   - Several named ranges, each with a min–max in µm, a colour and a name. The full range is **0.75–5.01 µm**, 6 detectors, 102 channels.
   - UI idea: one horizontal wavelength ruler (0.75–5.01 µm) with the 6 detector spans faintly marked. Each range is a draggable band on the ruler with two handles. Number fields for exact min/max (step 0.01). A colour swatch opens a picker (named presets + hex). The name field is inline-editable. Actions: add range, delete, and "Reset to defaults".
   - Validation: min < max, inside 0.75–5.01. Overlapping ranges get a visible warning but are still allowed (the team can decide otherwise).
   - Defaults: Nithil will send the default colours and names. Until then, use clearly labelled placeholders ("Default 1…"). Don't invent scientific band names.
   - Colour picker accessibility: warn when a chosen colour is too close to another range. Never use colour as the only cue: the band name is always shown.
   - It lives in a liquid-glass side sheet or popover opened from the stage tool rail.
4. **Hover a star to show its name**
   - A small glass tooltip near the cursor (offset so it doesn't hide the star) with the name and catalogue ID. Show it after a short delay (~120 ms) and hide it on leave.
   - Keyboard/touch: tap or focus shows the same label. On phone, tapping a star shows it.
   - Never covers the predicted-position ring.
5. **Observer location (opt-in)**
   - **Off by default.** A clear switch: "Use my location for alt/az and rise/set". The two ways in are "Use device location" (browser geolocation) or "Type a place" (city or lat/long).
   - When on, the coordinate panel gains: altitude/azimuth now, rise/transit/set times, and "up now / below horizon".
   - Privacy line right under the switch, always visible: **"Your location stays in your browser. It is never sent or saved anywhere."**
   - Design states for: permission denied (offer typed place), unknown place, and a location set (with a "clear" button).
6. **Loading screens: a person riding a rocket**
   - Real progress must stay visible and honest: "Finding images… 12 of 60 loaded". Frames appear in the timeline as they arrive. The retry state shows when IRSA is slow or erroring. The rocket is decoration on top of real progress, never fake progress.
   - The rocket character moves along the progress path (e.g. its x-position = fraction loaded), with gentle motion. **Reduced motion: a still pose**, with the progress bar still updating.
   - **Character art rules:**
     - If **The team designer draws it himself**, no mark is needed. It's his choice and he's been asked.
     - If **Claude or Blender** makes it (Blender counts as AI here, since an AI would drive it), it is AI-generated and **must carry a small visible "AI-generated" watermark** on the image itself.
     - **No NASA logo, meatball, worm or any agency insignia on the rocket**, and no real spacecraft likeness.
     - The person must be a generic cartoon character, not the likeness of any real person (under-18 rule).
   - Until his art arrives, design the slot with a simple placeholder silhouette labelled "character art: the team designer / pending", so Coding can drop the file in (SVG preferred, or PNG/Lottie).
   - Sound: none during loading, except the soft "loaded" confirm at the end.

## Also coming (don't design yet)
Nithil wants a metadata PDF (per image, per-pixel wavelength and channel) before deciding on "flagging" features. Leave flagging out for now.

Reply with the paths and anything you need from the team designer or Nithil.
