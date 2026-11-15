# Star Shift: name and logo

Given by Nithil on Sat 14 Nov 2026. The rules are in `design/DESIGN.md` section 0.

| File | Use |
|---|---|
| `star-shift-symbol.svg` | The logo exactly as supplied. Use at 64 px and larger |
| `star-shift-symbol-small.svg` | Small-size cut for 24-48 px (header). Derivative: same star, heavier ring and crosshair, wider gaps, no hairline ring. Approved by Nithil (21:21) and the team designer (21:22), Sat 14 Nov |
| `favicon.svg` | The small cut on an ivory tile, for the browser tab. Derivative, approved with the small cut |
| `size-test-original-vs-small.png` | Both versions at 20-128 px on ivory and on the dark stage: why the small cut exists, and why the symbol never goes on dark |

**Credit (one wording everywhere, Master, Sun 15 Nov):** "Logo: SI-generated with ChatGPT; small version and favicon redrawn as SVG by Claude."

- The badge beside the symbol reads **SI** (Space Apps calls AI "Super Intelligence"; confirmed from the FAQ by Submission Check).
- The credit line must be **visible** wherever the logo is shown (app, pitch deck, thumbnail still, design files). A tooltip alone is not enough.
- The original was made with ChatGPT (The team designer, Sat 14 Nov 22:29). The two derivatives were drawn by Claude (AI-written SVG).

## Drop-in for `web/`
1. Copy the three SVG files to `web/brand/`.
2. `web/index.html`:
   - `<title>Star Shift · the infrared sky over time</title>` and, in `<head>`, `<link rel="icon" type="image/svg+xml" href="brand/favicon.svg">`
   - rail: replace `<span class="logo-slot" title="…"></span>` with `<img class="logo-slot" src="brand/star-shift-symbol-small.svg" alt="" width="40" height="40">`
   - top bar: replace `<span class="logo-slot top-logo" aria-hidden="true"></span><span class="name">[Tool name]</span>` with `<img class="logo-slot top-logo" src="brand/star-shift-symbol-small.svg" alt="" width="28" height="28"><span class="name">Star Shift</span>`
3. `web/styles/e.css`:
   - line 58: `.logo-slot{width:40px;height:40px;margin-bottom:var(--s3)}` (no dashed border, no radius). **Do not add `display:block` here**: it un-hides `.top-logo` on desktop and the logo shows twice.
   - phone block: `.top-logo{display:block!important;width:28px;height:28px;margin:0}`
4. Replace every other "[Tool name]" (About text, share text, README) with "Star Shift".
