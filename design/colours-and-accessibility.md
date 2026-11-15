# Colours and accessibility: what was built

Design Studio, Sun 15 Nov 2026, 12:32 Sri Lanka time. Asked for by Nithil in the Design Studio session at 12:10 ("primary, secondary and tertiary colours can be changed", "a ton of accessibility options", "change colours in accordance with the different colour blindnesses").

## Files
| File | What it is |
|---|---|
| `web/app/access.js` (new, 263 lines) | The engine and the panel. A classic script loaded in `<head>`, so a saved palette is applied before the first paint. |
| `web/styles/access.css` (new, 137 lines) | What each option does to the app, and the panel's own styles. |
| `index`, `archive`, `spectral`, `proof`, `neo`, `spot`, `planetarium.html` | Two lines added before `</head>` (the stylesheet and the script). Nothing else in Coding's files was changed. |

Not committed. `npm test` passes with the new files (347 of 347).

## How to open it
Clarity (top bar) → **Colours and accessibility**. It opens as a side sheet on wide screens and a bottom sheet on a phone. It is not a modal: the page stays in view and recolours while you choose. Esc or Done closes it and focus goes back to the Clarity key. Choices are saved in this browser only (`star-shift-access-v1`) and apply on every page.

## Colours
- **Three colours, each with a job.** Primary: keys, links and the ring. Secondary: observed values and "agrees". Tertiary: warnings and "differs".
- **Any colour can be picked.** The engine keeps the hue and moves the lightness until each use is readable: at least 5.2:1 for text on the shell, 7.2:1 for small bold text on a tint, 4.6:1 for cream text on a key, 8:1 on the dark stage. A dark pick stays as dark as it was picked. The panel says so in words when it darkens a colour.
- **Four palettes:**

| Palette | Primary | Secondary | Tertiary | For |
|---|---|---|---|---|
| Star Shift | `#8A4719` copper | `#46604A` sage | `#A4452F` coral | The team's own colours. The default: nothing is overridden. |
| Red-green safe | `#2B2622` graphite | `#0072B2` blue | `#D55E00` orange | Protanopia, deuteranopia |
| Blue-yellow safe | `#2B2622` graphite | `#00707A` teal | `#B3123E` crimson | Tritanopia |
| No colour | `#2B2622` | `#5B5148` | `#111111` | Achromatopsia. Turns "Marks, not colour alone" on. |

- **Why the two safe palettes look like that.** Each kind of colour blindness still sees one colour axis (blue to yellow, or teal to red). The safe palettes put "agrees" and "differs" at the two ends of that axis and make the keys graphite.
- **Checked by simulation** (Machado, Oliveira and Fernandes 2009, full severity; distance in OKLab × 100):

| Palette, seen with | agrees vs differs | keys vs agrees | keys vs differs |
|---|---|---|---|
| Star Shift, protanopia | **3.8** | 6.6 | 2.9 |
| Star Shift, deuteranopia | 8.7 | 7.1 | 4.1 |
| Red-green safe, protanopia | 19.3 | 25.0 | 17.2 |
| Red-green safe, deuteranopia | 21.0 | 22.0 | 23.5 |
| Blue-yellow safe, tritanopia | 28.0 | 21.4 | 29.3 |

  So with the team's palette a red-blind reader sees "agrees" and "differs" as nearly the same colour (the words still differ). The safe palette makes that pair about five times further apart.
- **A strip in the panel shows the three colours as each kind of colour vision sees them** (the same simulation, as an SVG filter on real interface parts).
- **Marks, not colour alone:** a tick, cross, dash or wave on every verdict, and a dot, ring or bars on OBSERVED, COMPUTED and CATALOGUE.

## Other options
- **Text:** Larger text (the app's own 115% switch), typeface (Star Shift, System, Wide for reading text), roomy lines, wider letters and words, bolder text.
- **Seeing:** Increase contrast, Reduce transparency (both are the app's own switches), Softer light (a dimmer shell), Underline links, Outline every key, Stronger focus ring.
- **Motion, touch and sound:** Reduce motion and Sounds (the app's own), Larger keys (44 px).
- **Reset all.**

The five switches the app already had (motion, transparency, contrast, text, sounds) are pressed through Clarity's own switches, so Coding's storage stays the single source.

## Polish that is always on
`accent-color`, `caret-color` and scrollbar colour now follow the palette on every page.

## Checked
- Default state: no inline style, no attribute that changes anything; the app looks exactly as before.
- 1366×768 and 1366×640: every option on at once, no sideways scroll, nothing clipped in the dock or top bar.
- 390×844: each option alone, no sideways scroll.
- A saved palette survives a reload and is there on the Proof page too.
- Keyboard: focus moves into the panel, Esc closes it, focus returns to the Clarity key.

## Limits, said plainly
- **Things drawn on a canvas do not follow the palette:** the predicted-position ring on the image (fixed `#E3A86B` in JS, 8 places) and the band colours on the timeline (the band editor's own colours). Coding can read `--ring` and listen for the `star-shift-colours` event on `<html>`.
- **No text size above 115%.** I built 130% and 150% and took them out: the dock and top bar overlap, and enlarging only the panels overflowed on a phone. The honest tool for more is the browser's own zoom.
- **Found, not mine:** the app's existing Larger text switch makes the phone inspector about 32 px wider than the screen.
- **Not checked:** Safari, Firefox, a real phone, Expert mode, the tour while the panel is open, and Archive, Spectrum, Asteroids, Spot and Tonight? by eye (they load the same two files). Not checked with colour-blind people: the numbers above are a simulation.
- The simulation strip needs SVG filters and `color-mix()`, which every current browser has.

## Update, Sun 15 Nov 13:00: the default look is blue, white and neon yellow

Nithil, as team leader: 12:40 "change the color scheme to be not AI-generated looking"; 12:53, after a first cool-grey and Prussian-blue try, "Looks AI. Use Blue with white with neon yellow". The cool-grey try is gone; this replaces it.

**The look**
- **White:** paper `#F2F4FA`, raised surfaces `#F8FAFE`, keys almost pure white. Ink is navy `#182236`.
- **Blue:** `#1342C2` for links, switches and tags; the page rail is solid blue (`#2456E6` to `#0F37B0`) with white labels; plain keys carry blue lettering (`#0C34A6`).
- **Neon yellow:** only as a fill or a mark, never as text on white. The one main key on a screen (`#F1FF5C` to `#DCF514`, navy lettering), text selection, and the ring, compass and links on the dark image (`#EAF42F` on navy `#0A1121`).
- Sage ("agrees") and coral ("differs") are unchanged. The infrared image keeps its copper scale; the logo keeps its orange star.

**How it is built**
- `web/styles/look.css` (97 KB) and `web/styles/look-late.css` (about 14 KB) are **generated** by `design/tools/make_look.py`. The script reads every stylesheet and writes each rule again with the 201 warm colours moved (the mapping is the `move()` function), then adds a short hand-written block for the yellow key, the blue rail and the blue key lettering. Nothing in the app's own stylesheets is edited.
- `access.css` imports `look.css`; `access.js` adds `look-late.css` after the Expert styles, which arrive late.
- Every copied rule carries a zero-weight switch, `:where(html:not([data-ax-look=classic]))`, and keeps the original order, so the cascade is exactly the original one.
- **The copper look is kept** as the palette "First look: copper" in the Colours panel. One click brings it back on every page.
- With a colour-blind palette or picked colours, the yellow key, the blue rail and the blue lettering step back so the chosen colours lead.
- **After any change to a stylesheet, run `python design/tools/make_look.py` again**, or the new rule keeps its copper colour.

**Checked**
- Contrast, token by token, copper look against this one: higher everywhere (text 12.37 → 14.46; quiet text 5.22 → 6.10; links 5.45 → 7.38; marks on the image 9.01 → 15.68). Main key: navy on yellow 14.8 or more. Rail labels: 5.2 or more.
- By eye at 1366×768: cold open, Viewer, Proof. At 390×844: cold open and the Colours panel.
- `npm test` 359 of 359, `deploy/page-check.mjs` 12 of 12 pages, no errors.

**Not changed, and now different from the app**
- The pitch deck, the videos, the thumbnail still, and any screenshots in the README or submission still show cream and copper.
- Colours set in scripts (charts) keep their first values. One keyframe animation (`tour-pulse`) keeps its copper glow.

**Not checked in this look:** Spot, Archive, Asteroids, Spectrum and Tonight? by eye (they were seen in the cool-grey try, built the same way), Expert mode, the tour, Increase contrast, Softer light, Safari, Firefox, a real phone.

## Update, Sun 15 Nov 13:55: the astronaut loader matches the new look
Nithil: "Improve the astronaut animations also." The loader was re-rendered in Blender as scene v4 (blue, white and neon yellow; the rider waves; more sway; speed streaks) and re-encoded with the SI mark. Details: `design/loader/v1.1/README.md`, "Changes, v4". Seen playing in the app at 1366×768 (`design/mockups/shots/loader-v4-in-app-1366x768.jpg`).

