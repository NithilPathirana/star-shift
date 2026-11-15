# Work order 3: Direction E "Tactile glass instrument" (from Kurucharan, Sat 14 Nov ~17:15)

From: the UI/UX chat session (Kurucharan's design partner). To: Space Apps – Design Studio (Fable).
Kurucharan has picked **D1 Ivory instrument** as the base and wants it pushed much further. Everything below is his request, plus my guidance on how to make it work. Read it all before starting.

## 0. Deliverables and timing
1. `C:\SpaceApps2026\design\mockups\direction-e.html`: a working prototype of the core viewer screen. Reuse `assets\data.js` + `assets\render.js` (real Barnard frames + season stacks), and add it to `index.html`. Screenshots go in `shots\direction-e-*.png` at 1366×768, 1536×864, 1920×1080, 2560×1440 and 390×844 (phone), plus one with the Clarity panel open and one in Reduce transparency mode.
2. `C:\SpaceApps2026\design\DESIGN.md`: the design system drawn from E (the brief's required sections: colour tokens with contrast checked, type scale, spacing, components (search, frame player/scrubber, time slider, compare/blink, info panel, loading/error/empty), motion rules, **sound rules**, **material rules** (which "morphism" goes where), accessibility/clarity settings, phone layout). Coding builds the real site from this, so make it implementable in plain HTML/CSS/JS (no framework needed).
3. Message me back with the paths and a short list of what changed vs D1.
Target: the prototype by ~18:30, DESIGN.md by ~19:00 (the first full site is due ~19:00, so the Coding session needs it soon).

Use your skills: `impeccable` (all UI), `liquid-glass-css` (web Liquid Glass: real SVG displacement/refraction plus the pure-CSS backdrop-filter fallback), and `emil-design-eng` (motion and micro-interactions).

## 1. Bug to fix first: it must fit any window
Kurucharan opened D1 on a laptop (`127.0.0.1:8790/mockups/direction-d1.html?v=2`). His screenshot (`design\references\d1-laptop-bug.webp`) shows the page squeezed into a ~450 px column with scrollbars on both axes, inside a ~2000 px wide browser. Part of the cause is that D1 switches to the single-column layout at `max-width:1180px`, which is too eager for 125%/150% Windows scaling (a 1920 screen at 150% is a 1280 CSS-px viewport). It may also have been mid-resize. Either way, E must:
- Fill the window fluidly at every size: CSS grid with `minmax()`, `clamp()` for type and spacing, container queries (`@container`) for the panels, `dvh`/`svh` units, and the `<meta name="viewport" content="width=device-width, initial-scale=1">` he means by "the HTML function". Use a `ResizeObserver` to keep the image canvas crisp, at integer-pixel scaling where possible.
- Never show a page-level horizontal scrollbar. The image stage is always the largest element and never letterboxes into a tiny box.
- Breakpoints: wide desktop (≥1600), laptop (1100–1600, the main target: 1366×768 and 1536×864 must look designed, not squeezed), tablet (700–1100: info panel becomes a slide-over sheet), phone (<700: stage on top, controls dock at the bottom, info as a bottom sheet).
- Test by actually resizing a browser window from 360 px to 2560 px wide, and at browser zoom 125% and 150%.

## 2. The look: what Kurucharan asked for
Base: D1 (warm ivory/bone shell, copper accent, sage secondary, dark recessed image stage, Instrument Sans + IBM Plex Mono). Add:
- **Apple Liquid Glass**: the iOS 26 / macOS Tahoe design language. Glass that bends light at its edges (refraction), a specular rim highlight, adaptive tint taken from what's behind it, and controls that float in a layer above the content.
- **Modern skeuomorphism / "tactile minimalism"**: physical-feeling controls (press depth, machined edges, a knob-like play button, a detented scrubber, toggle switches that look like real switches), but minimal: no fake leather or wood textures and no clutter.
- **Neumorphism** (from D1) and **glassmorphism** (from his first doc) are still in the mix.
- **More depth from shadows**: layered, physically plausible shadows (contact shadow + ambient), with one consistent light source from the top-left.
- **Glass cards with highlights**: a top-edge specular line and inner rim light.
- **Cursor-tracking glare** on glass cards, inspired by Google sites (e.g. the soft light that follows the pointer on Google Store / Pixel / Gemini pages): a radial highlight that follows the pointer, ~6–10% opacity, eased (lerp), only on hover-capable pointers (`@media (hover:hover) and (pointer:fine)`), off in Reduce motion.
- **Backdrop blur** ("backdrop dripping" = backdrop-filter): use it only where something floats over content.
- **Apple-inspired animation**: spring physics for panels and sheets (critically damped, no bouncy cartoon overshoot), content that morphs between states (e.g. the Time/Compare/Blink switch morphs the stage layout), interruptible transitions.
- **Micro-interactions**: button press-in plus shadow compression; the scrubber thumb grows on grab; numbers tick through tabular digits when the frame changes; the copy-coordinates button gives a check-mark confirmation; the toggle has a slight squash; hover lifts by 1 px.
- **Subtle audio touches** (see section 4).
- **Clarity and accessibility toggles** (see section 5).
- Use his reference picture (`design\references\OBSERVATORY_reference_AI_image.jpg`) as a mood reference only. He said: "You do not need to make it the exact same as the reference image, use only as a reference." Ideas from it that you may adapt:
  - a slim nav rail on the left;
  - a floating vertical tool rail on the stage (select / pan / zoom in / zoom out / fit / layers);
  - a floating top bar with target coordinates;
  - a wavelength chip on the stage ("λ 4.93 µm · D6");
  - a "Source inspector"-style glass info panel;
  - a bottom dock with view chips;
  - warm light falling across the shell.

## 3. How the materials fit together (his words: "if not compatible, add the morphism that can work together, overpower some")
My ruling (use it unless you find a clear reason not to, and record the final mapping in DESIGN.md):
| Layer | Material | Why |
|---|---|---|
| App shell / background | Warm ivory surface with very soft neumorphic shaping (large radius, low-contrast) + warm light gradient | Neumorphism works on big calm surfaces; keep it subtle |
| Physical controls (play, step, speed, view switch, toggles, scrubber, search field) | **Tactile skeuomorphism overpowers neumorphism**: real press depth, clear edges, labels at AA contrast | Pure neumorphism fails contrast and affordance; skeuo keeps the tactile feel but readable |
| Floating layers (top bar, tool rail on stage, playback dock, info/"inspector" panel, popovers, Clarity panel, phone sheets) | **Liquid Glass overpowers classic glassmorphism**: refraction edge + specular rim + light blur | One glass language only; frosted glassmorphism = fallback for browsers without SVG backdrop filters (Firefox/Safari) and for Reduce transparency |
| The image stage (the science) | **Flat. No glass, no blur, no glare, no gradients on the pixels** | The data is the hero; nothing may alter or hide it. Glass may only float over the stage's empty margins/edges, never over the cutout |
| Text | Solid colour, never on raw glass without a tint layer behind it | Legibility |

## 4. Sound rules (subtle, never overpowering)
- Generate the sounds in code with the Web Audio API (short sine/triangle "ticks", a soft click, a gentle two-note confirm). No audio files and no AI-generated audio. Note in the footer credits that the UI sounds were synthesised by AI-written code.
- Events: button press (soft click), view switch (tick), the scrubber passing each season boundary (detent tick), results loaded (soft two-note confirm), error (low, short, not alarming). No sound per frame during playback, no ambient loops and no hover sounds.
- Volume: quiet (peak about −24 dBFS), ≤120 ms each, throttled so they never pile up.
- Starts only after the user's first interaction (browser autoplay rules). The sound on/off switch is in the Clarity panel and is remembered (localStorage, wrapped in try/catch). Default **on but quiet** (his ask), or off if the system asks for reduced motion.

## 5. Clarity and accessibility panel (a liquid-glass popover from a top-bar button)
Toggles (each remembered, and defaulting to the OS settings via media queries):
- **Reduce motion**: no springs, glare, morphs or number ticking; instant cross-fades. Default from `prefers-reduced-motion`.
- **Reduce transparency**: glass becomes solid tinted surfaces. Default from `prefers-reduced-transparency`.
- **Increase contrast**: stronger borders, darker text, no soft neumorphic edges. Default from `prefers-contrast: more`.
- **Larger text**: about +15% scale.
- **Sound**: on/off.
- **Image clarity** (for the science image): "Brightness stretch" (Auto / Linear / Strong), a "Show no-data hatching" switch, a "Show predicted-position ring" switch, and "Colour scale" (Copper / Grey for colour-blind or print users).
WCAG 2.2 AA throughout: visible focus rings (separate high-contrast copper), keyboard shortcuts (Space play/pause, ←/→ step, C compare, B blink, ? help), 44 px touch targets on phone, and `aria-live` for the frame date during stepping (not during playback).

## 6. Motion budget (must stay smooth on a laptop)
- Animate only `transform` and `opacity` (and `filter` on small elements). No layout-thrashing animations. Use `requestAnimationFrame` for the glare.
- Limit to ≤4 live `backdrop-filter` layers on screen at once. The SVG displacement (refraction) goes only on the 2–3 hero glass surfaces; the rest get the CSS fallback. Check that frame playback stays at 60 fps on an integrated GPU (throttle in DevTools at 4× CPU).
- Durations: 120–180 ms for presses and toggles, 240–360 ms for panels and sheets, spring for drags. Nothing loops in the background, and no particles or starfields.

## 7. The DON'Ts (from Kurucharan's own doc, section 28, plus the competition rules). All must hold.
Must not look like:
- a generic AI dashboard;
- an LLM chatbot app;
- an admin panel;
- a crypto dashboard;
- a gaming control panel;
- an ordinary SaaS template;
- a fictional spaceship UI;
- a website full of decorative glass cards;
- an exaggerated neumorphism concept;
- a standard NASA-themed landing page.

Avoid:
- generic AI colours, navy-blue navigation, purple-blue gradients, excessive cyan, neon glow;
- overly rounded cards, endless dashboard grids, excessive shadows, excessive backdrop blur;
- fake astronomical data, meaningless animations, decorative scientific graphics;
- non-functional buttons (anything not wired in the prototype gets a visible "proposal" tag), fake operational indicators ("Connected to IRSA" may only show if it's real);
- radar, rotating circles, orbit graphics, particles, sci-fi type, AI-assistant UI.

Competition rules:
- No NASA/SPHEREx logos, names-as-brand, mission insignia or spacecraft art. Keep "[Tool name]" and the dashed logo slot (his logo comes later). The data credit "Images: NASA SPHEREx via IRSA" is fine.
- Any AI image needs a visible watermark (so don't use any).
- No photos of anyone under 18.

## 8. Scope (SI rule: the team owns features)
Design the **core viewer** only:
- search (name or RA/Dec) with the 5 test targets as quick picks;
- stage;
- playback + season timeline;
- Time / Compare / Blink;
- info/inspector panel with OBSERVED / COMPUTED tags;
- loading (frames arriving one by one, IRSA can be slow), error (IRSA down: retry, with already-loaded frames kept) and empty (no SPHEREx images here) states.

Layer chips: only **IMAGE** and **FLAGS (no-data mask)** are real in our cutouts. Show other reference layers (VARIANCE, ZODI…) only if greyed out with a "proposal" tag, or better, leave them out. The nav rail may show "Viewer" and "About the data". The other workspaces from his doc (Archive, Spectral Explorer, Investigation, Findings, Gaia comparison) are team/Nithil feature decisions: leave them out.

## 9. Files to read
- `design\references\OBSERVATORY_style_prompt.docx` (his full doc), `OBSERVATORY_reference_AI_image.jpg` (mood), `d1-laptop-bug.webp` (the bug), `d1-and-reference.webp` (his two pictures side by side as sent)
- `design\mockups\direction-d1.html` (base), `assets\*`
- `C:\SpaceApps2026\evidence\EVIDENCE.md` (what the data really is)
