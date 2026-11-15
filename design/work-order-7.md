# Work order 7: fixes, the SI badge, and personalization/accessibility (Kurucharan, Sun 15 Nov ~08:50)

From: UI/UX chat session. To: **Coding (implements)** and **Design Studio (specs and checks)**. Scope tiers need the Master's OK because of the 14:00 feature freeze.
Kurucharan's full request, verbatim: `design\references\kurucharan-personalization-prompt.md`. Its core rule: **"Do not redesign Star Shift. Refine it."** The current look stays the default and must look almost identical with every new option off.

## P0: fix now (bugs Kurucharan saw; Coding)
1. **Pages stop halfway; you can't scroll to the bottom.** On `neo.html` (Asteroid Spotter) `body` has `overflow:hidden` (`body.neo-page`), but the page is 2493 px tall in a 768 px window. Everything below the first screen is unreachable: the "CNEOS threat context" section and the rest. `proof.html` (How we know) shows the same: the mouse wheel doesn't move the page and the table is cut at the bottom (checked at 1366×768). Fix: subpages scroll normally (the app-shell `overflow:hidden` should apply only to the viewer page), with the rail and top bar staying put. Check every subpage: Archive, Spectrum, Proof, Asteroids, Spot, Tonight?, More.
2. **Proof → "Honest limits" column is cut off mid-sentence** ("…hiding ev…", "…fe…" + "more"). These are the scientific caveats and must be readable. Show the full text (wrap the column, give it more width, or expand the row in place). No ellipsis on science text. Check the other tables for the same problem.
3. **Logo badge: "AI" → "SI".** Kurucharan wants the competition's own term ("Super Intelligence") in the badge under the logo, **smaller and more subtle** (lower visual weight). It must still be readable: about 9–10 px, letter-spaced caps, muted ink on ivory, AA contrast. `title`/`aria-label`: "Logo made with SI (ChatGPT)". The footer/About credit line can say "Logo: made with SI (ChatGPT)". The Master decided the badge itself; this only changes its wording and size.

## P1: if the Master approves before the freeze (Coding builds; Studio specs the look in DESIGN.md)
The highest-value, lowest-risk parts of his prompt, built into the **existing Clarity panel** (no new dashboard, progressive disclosure):
- **Appearance:** Theme = Original Star Shift (default, unchanged) / Light / Dark / System + 3–4 presets from §3 of his prompt (Lunar Graphite, Forest Instrument, Monochrome Laboratory, High-Contrast Instrument). One **accent colour** picker with HEX input, plus an **automatic harmony** that derives hover/pressed/selected/focus/disabled shades in **OKLCH**. Apply / Cancel (exact restore) / Reset to Original.
  - **Hard boundary:** interface tokens only. Semantic colours (errors/warnings) keep their meaning. **Scientific colours (the 6 bands, the copper image scale, the plots) never change with the theme.** The viewport is never tinted or blurred.
- **Accessibility:** text size, line height, contrast (Standard / Enhanced / High), **Simplified Instrument mode** (solid surfaces, stronger borders, fewer shadows, no glare), visible focus everywhere, labels/tooltips with shortcuts on icon-only buttons, and live contrast checking of custom colours (warn + offer a fix; never silently overwrite).
- **Colour-vision support for data:** the band ticks/legends get labels or shapes as well as colour; an optional colour-blind-safe *display* palette for bands, labelled as a display transform (values unchanged).
- **Motion:** Off / Minimal / Balanced (default = current) / Expressive, plus Fast / Standard / Relaxed. The OS reduced-motion setting wins.
- **Sound:** his rule is **all interface sounds OFF by default for new users** (this overrides the earlier "on but quiet"). Add a master volume plus category switches (navigation, controls, confirmations, scrollbar), a preview per category, rate limiting, and nothing before the first user gesture.
- **Precision scrollbar** (Classic / Precision / Quiet Instrument): native scrolling, styled with `::-webkit-scrollbar` + `scrollbar-color`, theme-aware, slightly more prominent on hover and pressed while dragging. A scroll-progress hairline only on long pages (Proof, Asteroids, About). Viewport zoom is untouched. Scrollbar sound is optional and off by default.
- **Persistence:** localStorage (try/catch), versioned settings JSON.

## P2: after the freeze / only if time (lower value for judging)
Full 10-token manual colour editor with detach/re-bind, RGB/HSL fields, EyeDropper, complementary/split harmonies, named profiles with rename/duplicate/import/export (validated JSON), contextual hints system, chart crosshair/keyboard inspection upgrades.

## Rules (unchanged)
- No redesign: same layout, rail, top bar, type, radii, spacing.
- The default theme is pixel-close to now. No navy default, no purple gradients, no neon.
- No new scientific features or claims.
- No network requests from settings. Don't re-render science views on theme change.
- Credits: "UI sounds synthesised by SI-written code" (match the SI wording if the team adopts it site-wide).

## Studio's part
Add a short DESIGN.md section "21. Personalization & accessibility" with the token map (interface vs semantic vs scientific), the preset token values (AA checked), the OKLCH harmony recipe, the scrollbar spec, the sound defaults, and the Clarity panel layout for the new sections (essentials first, "Advanced" disclosure). Then check Coding's build against it with screenshots.
