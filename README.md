# Star Shift – the infrared sky over time

**Open it:** LIVE_URL_GOES_HERE (no login) · **Source:** `source.zip` on the site (built with `npm run source-zip`) · **Licence:** MIT ([LICENSE](LICENSE))

Team **Proper Motion** (Colombo, Sri Lanka) – NASA Space Apps Challenge 2026, challenge *Planet X and SPHEREx*.
Type any sky position (or a star name) and see the SPHEREx images of that spot, lined up, as a little movie.

> **AI use (required disclosure): AI (Super Intelligence, SI).** All code in this repository was written by AI models
> (Claude, by Anthropic; a few modules, such as the Asteroids page, the lab notebook and the JPL relay route, by OpenAI Codex)
> working under the team's direction. The team chose the idea, checked the science and approved the design.
> Files carry an "AI-written code" header.
>
> Logo: SI-generated with ChatGPT; small version and favicon redrawn as SVG by Claude.

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
  - `irsa.js` – finds SPHEREx images and downloads cutouts, keeping only the IMAGE and FLAGS parts
    (~55 kB instead of ~4 MB per frame). Image lists: IRSA's fast SIA service, merged with IRSA's TAP
    table (one image per exposure and detector) wherever TAP is affordable: the five demo targets
    (saved in `web/prebaked/`) and the Node tools. Near the north ecliptic pole SIA lists far fewer:
    R Draconis has 539 images in SIA and 2,493 in TAP (1,258 exposures, each seen by two detectors).
    The Observation Archive adds TAP's extra images when TAP answers; live viewer spots stay on SIA.
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
The SPHEREx releases the app asks for, with their DOIs, live in one file, `web/data/releases.json`;
the image queries (`web/core/irsa.js`) and every credit line use it (`tests/releases.test.mjs` checks the pages).
- **NASA SPHEREx** spectral images from the NASA/IPAC Infrared Science Archive (IRSA), Caltech/IPAC:
  Data Release 1 (DR1) spectral images, DOI [10.26131/IRSA678](https://doi.org/10.26131/IRSA678), and
  Quick Release 3 (QR3) spectral images, DOI [10.26131/IRSA662](https://doi.org/10.26131/IRSA662)
  (DOIs as given on IRSA's SPHEREx DR1 and QR documentation pages). "This publication makes use of data
  products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices
  Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California
  Institute of Technology, and is funded by the National Aeronautics and Space Administration."
- **Gaia DR3**: ESA Gaia mission and DPAC (Gaia Collaboration, Vallenari et al. 2023, DOI 10.1051/0004-6361/202243940).
- **SIMBAD** astronomical database, CDS, Strasbourg (Wenger et al. 2000, DOI 10.1051/aas:2000332); asked through the Harvard mirror.
- **JPL Solar System Dynamics** (NASA/JPL): Small-Body Identification API, Small-Body Database, Horizons,
  and "Approximate Positions of the Planets" (E. M. Standish).
- **Hipparcos** (ESA), new reduction (van Leeuwen 2007, DOI 10.1051/0004-6361:20078357), via the ESA Gaia archive.
- **2MASS**: Two Micron All Sky Survey, a joint project of the University of Massachusetts and IPAC/Caltech,
  funded by NASA and the NSF; images via IRSA.
- **AllWISE**: NASA's Wide-field Infrared Survey Explorer (UCLA and JPL/Caltech) and NEOWISE; images via IRSA.
- **ATRAN** sky-transmission curves: Lord, S. D., 1992, NASA Technical Memorandum 103957; data courtesy of
  Gemini Observatory (`web/data/atran/README.md`).
- Methods follow the IRSA SPHEREx tutorial notebooks (cutouts, spectral WCS).
- NASA and SPHEREx names are used only to describe the data; no NASA or mission logos are used.

## Third-party licences
Bundled in `web/vendor/` (each folder keeps the library's own LICENSE file):

| Library | Version | Licence | Copyright |
|---|---|---|---|
| [three.js](https://threejs.org/) | 0.186.1 | MIT | 2010-2026 three.js authors |
| [Astronomy Engine](https://github.com/cosinekitty/astronomy) | 2.1.19 | MIT | 2019-2023 Don Cross |

Everything else in this repository is the team's own code under the MIT licence ([LICENSE](LICENSE)).
