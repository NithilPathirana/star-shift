# Spec: Judging Panel fixes b1, a6, b2, a5

Design Studio, Sun 15 Nov 2026, 10:56 Sri Lanka time. For Coding. Source: Obsidian `21 Judging panel – 2026-11-15 1019.md`.
Measured on the live app (`d1ff23e`) at 1366×640 and 390×844, Simple mode, fresh storage. Before screenshots: `design/mockups/shots/jf-*.png` (5 files).

All colours and sizes use the tokens already in `web/styles/e.css`. No new colours except the three verdict colours on the dark stage, given in section 2.

**The one rule that ties these together: one copper key per screen.** On the cold open that key is "Watch Barnard's Star move →". Everything else on that screen is a plain key.

Measured today (px, left,top width×height):

| | 1366×640 map | 1366×640 viewer | 390×844 map | 390×844 viewer |
|---|---|---|---|---|
| `#stage` | 89,82 966×462 | 89,82 966×380 | 8,211 374×404 | 8,197 359×387 |
| `#dock` | 89,556 1265×72 | 89,474 1265×154 | 8,637 374×199 | 8,593 359×332 |
| `.screens` | – | 165,134 840×284 | – | 20,245 335×259 |
| `.tour-offer` | 701,369 320×102 (on the sky) | same (on the image) | 8,211 374×56 strip (on the sky) | 8,245 strip (on the image) |

---

## 1. b1: first-screen story

### Copy (verbatim, the team's pitch line A, split at the sentence break)
- Line a: `Every six months, NASA's SPHEREx photographs the whole sky.`
- Line b: `Star Shift lets anyone flip through those photos, catch what moved, and prove it's real.`
- Key: `Watch Barnard's Star move →` (the arrow in `<span aria-hidden="true">`)

The key does what b2 describes: opens Barnard's Star in the viewer on the season-stack Blink.

### Markup (two copies, one shown per layout, the other `display:none`)
```html
<section class="story" aria-label="What Star Shift does">
  <p class="story-a">Every six months, NASA's SPHEREx photographs the whole sky.</p>
  <p class="story-b">Star Shift lets anyone flip through those photos, catch what moved, and prove it's real.</p>
  <button type="button" class="key primary story-go">Watch Barnard's Star move <span aria-hidden="true">→</span></button>
</section>
```
State: `html[data-story="on"]` while it shows. Not an `h1` (the page already has one).

### Desktop and tablet (≥ 700 px): a dark card on the stage, top left
Copy 1 goes inside `#stage`, map scene only.

```css
.story.on-stage{position:absolute;left:76px;top:14px;z-index:3;
  width:clamp(240px,calc(50% - 116px),360px);   /* never reaches the selected-patch marker at the centre */
  padding:16px 18px 18px;border-radius:16px;
  background:rgba(21,17,14,.82);border:1px solid rgba(255,235,210,.16);color:var(--stage-text)}
.story-a{font:400 .875rem/1.45 var(--font-ui);color:var(--stage-muted)}
.story-b{margin-top:6px;font:600 1.125rem/1.3 var(--font-ui);letter-spacing:-.01em;text-wrap:balance}
.story-go{margin-top:14px;min-height:44px}
```
- `left:76px; top:14px` is the band chip's own spot, so it lines up with the viewer.
- While the story is on, hide `#mapRead` (the "This spot: east, 28° up…" pill). The same words are in the dock's Cursor cell and the "Where to look" box.
- Size at 1366×640: 360 × about 205 px, at stage x 76–436, y 14–219. The stage is 966×462, so it covers about 16% of the sky. The selected-patch marker (centre, x 470–580) and the map credit (y 387+) stay clear.
- **One copper key:** while `data-story="on"`, `#cdPlay` ("Play this patch over time" in the right panel) takes the plain key look. It goes back to copper when the story leaves.
  ```css
  html[data-story="on"] #cdPlay{/* same rules as a plain .key: drop the .primary fill, ink text */}
  ```
  The dock's `#mdPlay` is already plain on desktop. Leave it.

### Phone (< 700 px): no overlay; the story takes the dock's place under the sky
Copy 2 goes in `#dock` as its first child, map scene only. It hides no sky at all: the page reads sky, then caption, then key.

While `data-story="on"` on phone:
- hide the Cursor / Selected row, the `#mdPlay` key and the Map colour slider;
- give `#dock` `min-height:199px` (its height today), so the stage does not move when the story leaves.

```css
@media (max-width:699px){
  .story.in-dock{padding:2px 2px 0}
  .story.in-dock .story-a{font:400 .8125rem/1.4 var(--font-ui);color:var(--muted)}
  .story.in-dock .story-b{margin-top:4px;font:600 1.0625rem/1.3 var(--font-ui);letter-spacing:-.01em;color:var(--ink)}
  .story-row{display:flex;gap:8px;margin-top:12px}
  .story-row .story-go{flex:1;min-height:48px;margin-top:0}
  .story-row .story-tour{flex:none;min-height:48px}   /* see section 4 */
}
```
Height: 2 lines + 3 lines + 48 px key = about 166 px inside the 199 px dock. Fits at 390×844 with nothing below the fold.

### When it shows and when it leaves
- Shows on every load that lands in the map scene (stateless, no storage: it is the page's headline). The key always goes to Barnard's Star.
- Leaves on the first of: pointer down, wheel or key pan on the map; a search; a preset chip; the scene changing to the viewer; the tour starting.
- Leave: `opacity 1→0, transform translateY(-4px), 180ms var(--ease-out)`, then `hidden`. Enter: none (it is there at first paint, so the 0 s screenshot shows it). `html[data-motion=reduce]`: no transition.
- No close key: any touch of the map removes it, and it blocks nothing.

**Done looks like:** a 0 s screenshot of `/` at 1366×640, 1440×900 and 390×844 shows both lines and one copper key; the selected-patch marker is visible; no second copper key on screen.

---

## 2. a6 + b2: one "result plate" for the caption and the measured chip

The caption (b2) and the measured chip (a6) sit together as two lines of one block, `#resultPlate`: words on top, numbers under. Viewer scene only.

```html
<div class="rp" id="resultPlate">
  <p class="rp-cap">Barnard's Star moved 10.3″ in 1.0 years, about 1.7 pixels.<span class="rp-cat"> Gaia says 10.39″/yr.</span></p>
  <p class="rp-res num">
    <span class="rp-k">Measured here</span> <b>10.32 ± 0.27″/yr</b>
    <span class="sep">·</span> <span class="rp-k">catalogue</span> 10.39
    <span class="sep">·</span> <span class="rp-v agrees">AGREES</span>
    <span class="sep">·</span> <a class="rp-how" href="proof.html#barnard">How we know →</a>
  </p>
</div>
```

### 2a. Desktop (≥ 700 px): on the stage, bottom centre, under the image

```css
.rp{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:3;
  display:flex;flex-direction:column;align-items:center;gap:4px;
  width:max-content;max-width:calc(100% - 280px)}   /* clears the compass (left) and the scale bar (right) */
.rp-cap{padding:2px 10px;border-radius:8px;background:rgba(21,17,14,.82);
  font:500 .875rem/1.35 var(--font-ui);color:var(--stage-text);text-align:center;text-wrap:balance}
.rp-res{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:0 8px;
  min-height:30px;padding:0 12px;border-radius:15px;   /* same glass, border and font as .chip */
  font:400 .75rem/1.5 var(--font-num);color:var(--stage-text)}
.rp-k,.rp .sep{color:var(--stage-muted)}
.rp-res b{font-weight:600}
.rp-how{color:var(--ring);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
.rp-v{padding:0 6px;border-radius:4px;border:1px solid;font:600 .6875rem/1.5 var(--font-num);letter-spacing:.04em}
.rp-v.agrees{color:#9DB89F;border-color:rgba(157,184,159,.5)}          /* --cross */
.rp-v.nm{color:var(--stage-muted);border:1px dashed rgba(255,235,210,.4)} /* NOT MEASURABLE */
.rp-v.limit{color:var(--ring);border-color:rgba(227,168,107,.5)}        /* AT THE LIMIT, if a7 adds it */
.rp-v.differs{color:#E0907A;border-color:rgba(224,144,122,.5)}          /* coral, lightened for the dark stage */
```
Give `.rp-res` the same `--glass-tint` / border lines as `.chip` (e.css:186, 201) so the two pills match.

**Room for it (the image must not be covered):**
- The strip under `.screens` is 44 px today. The plate needs 57 px (caption 23 + gap 4 + pill 30) plus 8 px below and 6 px above. Set the `.screens` bottom inset to **72 px** in the viewer on desktop, in every mode, so the image does not resize when the mode changes.
- Cost at 1366×640: the image goes from 276 to about 248 px. At 1366×768 and up it stays above 370 px.
- **Clean blink key:** it sits at bottom centre today (513,414 117×36) and would collide. Move it to the stage's top right on desktop: `right:14px; top:11px`. Do the same with anything else at bottom centre (the Compare "Cross = …" note of a8, if it is there). On phone leave them where they are.
- Compass (bottom left) and scale bar (bottom right) do not move.
- Width at 1366: the pill is about 590 px, centred at x 277–867 inside the 966 px stage. Below about 1150 px wide it wraps to two lines (`border-radius:15px` already allows that).

### 2b. Phone (< 700 px): first block of the dock, light, directly under the image
The stage has no free strip on a phone (21 px between the image and the tool bar), so the plate moves into `#dock` as its first child. It sits 9 px under the image and reads as its label.

```css
@media (max-width:699px){
  .rp{position:static;transform:none;width:auto;max-width:none;align-items:stretch;gap:6px;
    padding:2px 2px 12px;margin-bottom:10px;border-bottom:1px solid var(--edge)}
  .rp-cap{padding:0;background:none;text-align:left;font:500 .875rem/1.35 var(--font-ui);color:var(--ink)}
  .rp-res{justify-content:flex-start;padding:0;min-height:0;background:none;border:0;color:var(--ink)}
  .rp-k,.rp .sep{color:var(--muted)}
  .rp-res b{flex-basis:auto}
  .rp-res .brk{flex-basis:100%;height:0}          /* a line break after the measured value */
  .rp-how{color:var(--copper-ink);display:inline-block;padding:12px 0;margin:-12px 0}   /* 44 px tap height */
  .rp-v.agrees{color:var(--sage-ink);background:var(--sage-tint);border-color:transparent}
  .rp-v.nm{color:var(--muted);border:1px dashed var(--edge-strong)}
  .rp-v.limit{color:var(--copper-ink);border-color:var(--edge-strong)}
  .rp-v.differs{color:var(--coral);border-color:currentColor}
}
```
Two lines on a phone: `Measured here 10.32 ± 0.27″/yr` / `catalogue 10.39 · AGREES · How we know →`. Put `<span class="brk"></span>` after the `<b>`.
Height about 97 px. The transport row and the timeline stay in the 844 px viewport; the Time / Compare / Blink / Telescopes row ends about 35 px below the fold (the page already scrolls there today).

### 2c. The measured chip (a6): states and text
| State | Text |
|---|---|
| Measuring | `Measuring motion… 45/120` |
| Done, catalogue value exists | `Measured here 10.32 ± 0.27″/yr · catalogue 10.39 · AGREES · How we know →` |
| Done, not measurable | `Motion can't be measured here · NOT MEASURABLE · How we know →` |
| Done, no catalogue value (a live spot) | `Measured here 0.42 ± 0.31″/yr · How we know →` (no verdict tag) |

- Measuring: the text in `--stage-muted`, the count in `--stage-text` with `font-variant-numeric:tabular-nums`, and the pill fills from the left as a progress bar:
  `background-image:linear-gradient(90deg,rgba(227,168,107,.22) var(--p),transparent var(--p))` with `--p` = n/N as a percentage. On phone the same bar is a 2 px line under the text (`background-size:100% 2px; background-position:0 100%; background-repeat:no-repeat`).
- Measuring → done: swap the text with `opacity` 160 ms. Do not animate the width.
- Same exact numbers in Simple and Expert. Simple must not round to "about 10" here.
- The verdict word, the numbers and the units come from the same source as the Proof row (`proof.json` or the live fit). The chip and Proof must never disagree.
- `How we know →` goes to that target's row on the Proof page.
- Screen readers: announce only the final state, once (a visually hidden `aria-live="polite"` span), not every count.
- The chip shows in all four viewer modes.

### 2d. The caption (b2)
- Shows only on the season-stack Blink (and Compare of the two stacks) of a preset, and only when the motion was measured. Hide it for NOT MEASURABLE targets and for live spots; the chip alone carries those.
- Text: `{Name} moved {d}″ in {t} years, about {px} pixels.` then `Gaia says {cat}″/yr.` in `.rp-cat`.
- **`.rp-cat` shows only while the chip is still measuring.** Once the chip is done it already says "catalogue 10.39" one line below, so the caption drops that sentence (`.rp.done .rp-cat{display:none}`).
- **All numbers are computed, none typed.** The panel's sample text says "10.3″ in 1.1 years". The two seasons in the app are 15 Aug – 1 Oct 2025 and 16 Aug – 22 Sep 2026, which is about 1.0 years apart, and 10.3″ in 1.1 years would not match the 10.32″/yr in the chip right under it. Take `t` from the two seasons' mid-dates, `d` from the fit over that time, `px` = d / 6.15.
- The caption appears when its numbers exist. Until then the plate shows only the measuring chip (no placeholder sentence).

**Done looks like:** opening Barnard's Star from the story key shows the hop, the caption and the measuring chip within 5 s with no clicks; at 45 s the chip shows the final line; nothing overlaps the image at 1366×640, 1440×900 or 390×844; the Clean blink key is at the top right on desktop.

---

## 3. a5: where the tour offer docks

Rules (from the panel, kept): no offer in the viewer scene or on a deep link; it leaves on the first pick, search or Play, or after 8 s; whatever way it leaves, store it as seen, so it never comes back. **Note:** `/` redirects to `?q=Barnard%27s+Star`, so "the URL has q" alone would mean the offer never shows. Treat that default redirect as a cold open.

### Desktop (≥ 700 px): a small callout hanging from the Tour key
It hangs under `#tourPageKey` and lies over the top of the right panel, never over `#stage`.

```css
.tour-offer{position:fixed;z-index:20;width:296px;
  /* top = #tourPageKey bottom + 10px (71px at 1366×640); right = distance from the window edge to the top bar's right edge (12px) */
  display:flex;align-items:center;gap:8px;padding:8px 8px 8px 14px;border-radius:14px}
.tour-offer-t{flex:1;min-width:0;font:600 .875rem/1.25 var(--font-ui);color:var(--ink)}
.tour-offer .key{min-height:36px}
.tour-offer::before{content:"";position:absolute;top:-5px;left:var(--notch-x);width:10px;height:10px;
  transform:rotate(45deg);background:inherit;border-left:1px solid var(--edge);border-top:1px solid var(--edge)}
```
- Box at 1366×640: x 1058–1354, y 71–123. The stage ends at x 1055, so it clears the image by 3 px; keep `width:296px` (320 would touch it). At 1440×900 the same rule holds.
- `--notch-x` = the Tour key's centre minus the callout's left edge, minus 5 px. Set `transform-origin` to the same point.
- Content, left to right: `New here? Take a guided tour`, a **plain** key `Start tour` (not copper: the story key is the only copper one), and a 36×36 quiet ✕ key with `aria-label="Not now"`. The text key "Not now" goes.
- Enter: `opacity 0→1, scale .96→1, 200ms var(--ease-out)`. Leave: 150 ms.
- The 8 s timer pauses while the pointer or keyboard focus is inside the callout.
- When it leaves without a choice, pulse the Tour key once so people see where the tour lives: `box-shadow: 0 0 0 0 → 0 0 0 6px rgba(138,71,25,.28) → 0 0 0 6px transparent`, 600 ms, once. Not under `html[data-motion=reduce]`.
- It covers the panel's heading ("Barnard's Star") for at most 8 s. That is the trade for never touching the image.

### Phone (< 700 px): no floating card at all
- Remove the `.tour-offer.strip` variant. The top bar on a phone has no Tour key to hang a callout from, and there is no free space below the dock (the dock ends at y 836 of 844).
- The offer becomes a plain key beside the story key (section 1, `.story-row`):
  ```html
  <div class="story-row">
    <button class="key primary story-go">Watch Barnard's Star move <span aria-hidden="true">→</span></button>
    <button class="key story-tour" aria-label="Take the guided tour">[compass icon] Tour</button>
  </div>
  ```
  Widths at 390: story key about 258 px, Tour key about 76 px, gap 8 px.
- It needs no timer: it leaves with the story, and the tour stays in the Pages sheet.

### Map credit on a phone: do NOT fold it into an "i" key
The panel suggested this to make room for the offer. With the offer in the dock the room is no longer needed, and folding would hide two lines that must stay in view: the NASA/SPHEREx imagery credit, and the logo credit (Master's rule, Sun 15 Nov: visible, not tooltip-only). Keep `#mapCredit` as it is. One wording fix on touch screens: `Drag to look around, pinch to zoom.` (it says "scroll to zoom" today).

**Done looks like:** at 1440×900, 1366×640 and 390×844, `?q=Barnard%27s%20Star&scene=viewer` shows no card over `#stage` at 3, 10 and 45 s; on a cold `/` the desktop callout does not touch `#stage` and is gone by 9 s; on a phone no strip appears.

---

## 4. The cold open, all together

- **Desktop 1366×640:** story card top left on the sky (one copper key), tour callout top right under the Tour key (plain keys), right panel's Play key plain, dock unchanged.
- **Phone 390×844:** sky untouched except its credit; dock shows the two story lines, the copper story key and a plain Tour key.
- **After the first touch:** the story and the offer are gone, `#mapRead` is back, `#cdPlay` is copper again, the phone dock shows its normal rows.

## 5. Not checked
- Compare and Telescopes: I did not look at what sits in the bottom strip of the stage in those modes. If something is there, it collides with the plate; tell me and I will place it.
- Widths between 700 and 1150 px (the story card narrows to 240 px, the chip wraps): sized by rule, not looked at.
- Blink on a phone: I did not see where the Clean blink key sits there.
- Increase contrast and Large text with the new pieces.

I will do one by-eye pass at 1366×640, 1440×900 and 390×844 when these land.

---

## Review log

### b1, reviewed Sun 11:18 at 1366×640, 1440×900 and 390×844 (commit dcbd358, fresh storage, Simple)
**Pass.** Screenshots: `design/mockups/shots/jf-b1-after-*.jpg`.

Seen and measured:
- Desktop: the card is 360×204 at stage 76,14 at both sizes; both lines and the key are on screen at first paint; the selected-patch marker and the map credit are clear of it. "Watch Barnard's Star move →" is the only copper key (the panel's Play key and the search Show key are plain).
- One click on the sky: the story leaves, the "This spot" pill comes back, the Play and Show keys turn copper again.
- Phone: no overlay on the sky. Both lines, the copper key (248×48) and the plain Tour key (80×48) sit in the dock, all inside 844 px with no page scroll. One tap on the sky: the story leaves and the stage stays at top 212 before and after. The hidden dock rows use `visibility:hidden`, so they are not reachable by keyboard.
- "Pinch to zoom" is in the phone map credit.

Coding's two choices:
1. **Show key plain while the story shows: confirmed.** It keeps one copper key. Add, if it is not there already: the story also leaves when the search field takes focus, so Show is copper again as soon as someone starts a search.
2. **Phone story laid over the dock's own rows: confirmed.** The stage does not move, which was the point.

Small polish, none blocking:
- Phone, line a breaks as "…photographs the whole / sky." Add `text-wrap:pretty` (or `balance`) to `.story-a` to avoid the one-word last line.
- Phone, as served to me the dock is 199 px tall and the story block is 173 px, starting 13 px from the dock's top, so there are about 46 px of empty space under the keys. If that is still so in your build, centre the block (equal space above and below).
- At 1440×900 the sky is still black 2 s after load and painted by about 6 s. The sentence and the key are there from the start, so the panel's 0 s screenshot passes, but it shows them over an empty stage. Not part of b1.

Not looked at: the 700–1150 px widths, Increase contrast, Large text, and the key's action (it waits for b2).
