# Final visual review 2: list for Coding

Design Studio, Sun 09:00 Sri Lanka time, 15 Nov 2026. Covers the changes since the 04:49 pass. Server `http://127.0.0.1:8787/`; started at HEAD 7787fb6, and c20b573 (the SI badge) landed while I was testing.

**Covered**
- Audit script (`design/tools/audit.js`) on 8 views (map, time-lapse, archive, spectral, proof, neo, spot, planetarium) at 1366×640, 1366×768 and 390×844, each in Simple and Expert: 48 runs.
- By eye at 1366×640, Simple: Viewer (compass, "Where to look", tool rail), sky map with band paint on, lab notebook, Spot through to a verdict, Asteroids, Archive with More filters, the Time-lapse tour chapter (5 steps).
- By eye at 1366×640, Expert: Viewer only.
- By eye at 390×844, Simple: Viewer, Pages sheet, "Can I see it tonight?".

**Overall: no blocker.** The audit is clean on every desktop run in both modes: one h1, Clarity key, rail fits, no sideways scroll, no text under 11 px, no low-contrast text. The only desktop hits are two search fields measured inside taller boxes (false alarms). From the 04:49 list I confirmed items 1, 2, 4 (close key and contrast), 6 and 8 as fixed; the phone switches in item 4 are still small (point 3 below).

## Blocker
None.

## Before 2 pm

1. **Band names read like detections on the sky map key and in the Archive.** The map key and the Archive show "Brown Dwarfs", "Water Ice", "CO₂ Ice" as plain coloured labels, with no sentence saying what they are. The Viewer chip does it right: "Brown-dwarf band · 4.42–5.01 µm". Fix: add one line, "Names for wavelength ranges, not detections", under the map key's title and under the Archive's Band filter (and on Spectrum if it is missing there too; I did not look). Use one form of each name in all places: either "Brown Dwarfs" everywhere or "Brown-dwarf band" everywhere.
2. **Band paint on: the map's labels still say one wavelength.** With the map coloured by the six ranges, the credit reads "Imagery: … at 1.63 µm" and the dock slider reads "Map colour · 1.63 µm". While paint is on, say "coloured by your six band ranges" in the credit, and grey out or relabel the slider ("Plain map · 1.63 µm").
3. **Phone, "Can I see it tonight?":** the three Show switches (Alt-az grid, Names, Show below the horizon) are 46×26, and the "How each row was chosen" line is 32 px tall. Give each a 44 px tap area. Carried over from the last list.
4. **Two compasses.** The Viewer has the new N/E arrows (copper N). Spot still has the old plain N/E corner. Use the Viewer's compass in Spot.
5. **Spot verdict text says "Barnard's star"** (small s) twice, while the title and the field line say "Barnard's Star". Use the catalogue name as given.

## Nice to have

6. **Scrollbars.** The More pop, the lab notebook and the Archive table show the default grey Windows scrollbar with arrow buttons. `scrollbar-width:thin; scrollbar-color:var(--edge-strong) transparent` on those three would match the shell.
7. **Desktop "More" pop at 640 px tall** repeats the six pages the rail already shows, so it has to scroll to reach the tour keys. Showing only Notebook, Help, About, Expert and the tour keys would fit without scrolling.
8. **Sky map: two identical copper "Play this patch over time" keys** on one screen (details panel and dock). Make the dock one a plain key on desktop.
9. **Asteroid Spotter:** objects of 21 to 24 mag offer "Show in time-lapse", although Spot's own rule treats anything fainter than about 18.5 as far too faint for SPHEREx. Put the same words in the Brightness cell ("far too faint for SPHEREx to see").
10. **Viewer dock:** the second row (Layers, FLAGS) is still two-thirds empty on desktop (item 9 of the last list).
11. **Spot at 1366×640:** the Pause blink / First / Latest keys sit on the fold (their bottom edge is about 2 px below the window).
12. **Phone Viewer:** the "Other source" hit area on the image is 30×30.

## Checked and fine
- Simple/Expert switch: present on every page (rail foot on desktop, Pages sheet on phone), 52×28 or larger, state shared across pages. Expert adds "V 9.5 (SIMBAD)" and coordinates to the Viewer's panel without breaking the layout.
- Tour: the Tour key is in the top bar on every page; the Time-lapse chapter's five cards are all on screen at 1366×640 and none covers its target.
- Compass (Viewer), "Where to look" box, light lab notebook, calm no-data fill, band paint with Hold to compare, Spot's purpose text, verdict card, Clear all and remove keys (seen, not clicked), Asteroids first screen (4 rows at 640), Archive More filters (6 rows at 640 folded, 4 open).
- Phone "Can I see it tonight?": the sheet now leaves the sky visible, and the close key no longer sits on the answer card's tag.
- The wavy line along the top of some images is the airglow mark from section 23, not a fault.

## Not covered
- Reduce motion, Increase contrast and Large text switched on.
- Safari, Firefox and a real phone.
- The other tour chapters, and the full tour across pages.
- Expert mode by eye on pages other than the Viewer (audit only).
- Spectrum, Proof and the desktop "Can I see it tonight?" by eye in this pass (audit only).
- Spot: I did not click Remove or Clear all, and did not trigger "Not a separate dot" or "Unexplained".
- Whether the carried-over items of the last list's point 5 (Clean blink label, axis-break marks, logo on the still, notebook "+" size) are in.

## Notes
- My test pressed "Add this position to the lab notebook" once by mistake. The entry is only in the test browser's own storage, not in the app's files.
- `C:\SpaceApps2026\.impeccable\` is an untracked folder made by a design-check hook, not by the app. Leave it out of commits.
- The logo badge now reads "SI". The pitch deck (`design/pitch/star-shift-pitch.html`) still says "AI" beside the logo and "AI use, declared" on slide 4; that is Master's call.

Screenshots: `design/mockups/shots/final2-*.png` (10 files).
