# Star Shift – the infrared sky over time

Team **Proper Motion** (Colombo, Sri Lanka) – NASA Space Apps Challenge 2026, challenge *Planet X and SPHEREx*.
Type any sky position (or a star name) and see every SPHEREx image of that spot, lined up, as a little movie.

> **AI use (required disclosure).** All code in this repository was written by an AI model
> (Claude, by Anthropic) working under the team's direction. The team chose the idea,
> checked the science and approved the design. Files carry an "AI-written code" header.

## The web app (`web/`)
- `index.html` + `styles/tokens.css` (all colours, type, spacing, radii, motion as CSS variables) + `styles/app.css`.
- `app/main.js` wires the page; `app/state.js` (pure reducer: idle → resolving → listing → loading → ready / empty / error);
  `app/query.js` (star names or RA/Dec in common formats, friendly errors, shareable URLs `?q=` or `?ra=&dec=` plus settings);
  `app/data.js` (pipeline shared with `tools/prebake.mjs`); `app/render.js` (brightness scales, smooth/true pixels);
  `app/presets.js` (NASA's five test targets, so they work even if SIMBAD is down).
- Keyboard: Space play/pause, ←/→ step, Home/End. Respects reduced motion (no auto-play).
- `node tools/prebake.mjs` (server running) fills the disk cache for the five targets so they load instantly and offline.

## How it works
- `web/core/` – plain JavaScript, runs in the browser and in Node:
  - `irsa.js` – finds SPHEREx images through IRSA's TAP service and downloads cutouts,
    keeping only the IMAGE and FLAGS parts (~55 kB instead of ~4 MB per frame).
  - `fits.js` – small FITS reader. `wcs.js` – TAN-SIP sky ↔ pixel maths (matches Astropy to <1 mas).
  - `motion.js` – moves a star along its proper motion to each image date.
  - `align.js` – puts every frame on one north-up sky grid and measures star positions.
  - `wave.js` + `data/spectral_wcs.json` – wavelength seen at each pixel (linear variable filters).
  - `resolve.js` – star names via SIMBAD (Harvard mirror); proper motions via Gaia DR3.
- `server/server.mjs` – local server: serves `web/` and relays read-only requests to IRSA and
  Gaia (they don't send CORS headers) on http://127.0.0.1:8787. Cutouts are cached on disk in `.cache/`.
- `proxy/worker.js` – the relay logic itself; the local server uses it, and the same file can run
  as a Cloudflare Worker if the site is ever published. No secrets, no storage.
- `tests/` – `npm test` (offline, checked against Astropy reference values).
- `tools/prove_targets.mjs` – live run on NASA's five test targets; results in `evidence/`.

## Run it (Windows)
Double-click `start.vbs` (no console window; opens the browser). `stop.vbs` stops it.
Needs Node.js 20+. Or run `node server/server.mjs` in a terminal.

## Data and credits
- SPHEREx data from the NASA/IPAC Infrared Science Archive (IRSA), Caltech/IPAC.
  This publication makes use of data products from SPHEREx, a NASA Medium Explorer mission.
  DOIs: QR2 [10.26131/IRSA652](https://doi.org/10.26131/IRSA652), QR3 [10.26131/IRSA662](https://doi.org/10.26131/IRSA662).
- SIMBAD database (CDS, Strasbourg; Harvard mirror). Gaia DR3 (ESA, Gaia DPAC).
- Methods follow the IRSA SPHEREx tutorial notebooks (cutouts, spectral WCS).
- NASA and SPHEREx names are used only to describe the data; no NASA or mission logos are used.
