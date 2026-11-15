# Final visual pass: prioritised list for Coding

Design Studio, Sun 04:49 Sri Lanka time, Sun 15 Nov 2026. Written to a file because the app has paused this session's messages to other sessions.

**Covered:** index (map and time-lapse), archive, spectral, proof, neo, spot, planetarium and the tour, at 1366×640, 1366×768 and 390×844, with `design/tools/audit.js` (21 page-and-size runs) and by eye. Design only; function is with the QA agent.

**Overall:** no blocker. The audit is clean on proof and neo at every size, and on index, archive, spectral and spot apart from a search-field measurement that is a false alarm (the 23 px input sits inside a taller field). No page scrolls sideways. Every page has one h1, the Clarity key, the Pages key on phone, and a rail that fits at 640 px tall. The tour runs seven steps with every card on screen at 1366×640.

## Blocker
None.

## Before 2 pm

1. **Viewer at 1366×640: the Ghost key is cut off.** With the two-row dock the stage is 380 px tall, and the stage tool rail is 351 px tall starting 56 px down, so it runs about 27 px past the stage's bottom edge and the last key (Ghost) is clipped. This is the main view at the commonest laptop size. Fix: under 700 px tall, make the tool keys 36 px with 4 px gaps and drop the "fit" label, or start the rail 12 px from the stage top beside the chip. Check with the Ghost bar open too.
2. **Asteroid Spotter at 1366×640: no result on the first screen.** The table starts at 558 px. Make the panel heading 18 px, put the "not detections" line beside it, and keep the form on one row directly under, so at least three rows show.
3. **Map to viewer: the loader flashes.** On a 2 s load the astronaut loader faded in at about 0.9 s and left at 2.0 s. Decide at 900 ms and show it only if 2 s or more of loading remain at the rate so far; otherwise let the images fill in behind the thin progress line. (Skip this if the pre-baked data now makes every target load at once: then check one uncached patch instead.)
4. **"Can I see it tonight?"**
   - The "Best case…" line is 4.09:1 (11.25 px coral on ivory). Use `--copper-ink`, as the tags do.
   - The band keys in the air panel are 21 px tall on desktop (24 px minimum) and 43 px wide on phone.
   - On phone the three Show switches measure 46×26 and the sheet's close key 40×44: give each a 44 px tap area.
   - On phone the close key sits on the top-right corner of the answer card, over its COMPUTED tag. Move the tag left of the key or put the key above the card.
5. **Carried over from my last two reviews** (ignore any that are already in):
   - Clean blink: keep one small label saying which season is on screen ("first season" / "last season", mono 11 px, ivory 60%, bottom-left).
   - Brightness over time: a small axis-break mark between the three season blocks.
   - The thumbnail still: the Star Shift symbol on its ivory tile with the AI mark beside the "Star Shift" line.
   - Viewer notebook "+" keys: 22 px drawn on desktop, make them 24 px.

## Nice to have

6. **Archive at 1366×640:** four rows on screen (table top 331 px). Under 700 px tall, fold the second filter row (Detector, Flags, Release, search) behind a "More filters" key.
7. **How we know at 1366×640:** five of seven rows on screen. Two fewer pixels of row padding, or two-line limits at this height, would show all seven.
8. **Phone "Can I see it tonight?":** arriving with an object opens the details sheet over the whole screen, so the sky is not seen at all. A sheet 46dvh tall (as in section 12) would show the answer and the sky with its reticle together.
9. **Viewer dock:** the second row (Layers, FLAGS) is two-thirds empty on desktop. It is the natural home for the layer legend that now sits on the stage.
10. **Archive on desktop:** FITS and Play are inline links (15 px tall). Fine as text links; 24 px keys would match the rest of the row.

## Not covered by this pass
- Reduce motion and Increase contrast switched on.
- Safari, Firefox and a real phone.
- Animations watched on a visible screen: I measured states by script, as the build agents did.
- The "Unexplained: worth reporting" path in Spot a mover, "Surprise me", and what the notebook saves.
- Whether the three carried-over items in point 5 are already fixed.
