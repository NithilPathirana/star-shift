<!-- AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026 -->
# Codex handoff: Near-Earth objects and orbit comparison

This handoff contains two standalone Star Shift pages plus a strict JPL relay mapper. Existing files were not changed; the lead can integrate these additions after the concurrent main-app work is complete.

## What was built

### I — Near-Earth objects

`web/neo.html` loads recent 30-day and upcoming 60-day Earth approaches within 0.05 au from CAD, plus the current Sentry summary list. It shows:

- an honest top summary (highest Torino value, closest upcoming approach and count within 1 LD);
- an SVG time-versus-log-distance chart with the Moon marked at 1 LD;
- a sortable, LD-first approach table with kilometres, au, speed, H and measured or H/albedo-estimated diameter;
- a sortable Sentry table with cumulative probability, Palermo values and meanings, Torino chips, size, years and potential-impact count;
- an SBDB object drawer with orbit elements, MOID, physical parameters and future Earth approaches;
- loading/error states, source/fetch time, cache-age warning, keyboard row activation and phone card rows.

### J — Orbit comparison

`web/orbits.html` starts with Earth and Mars and accepts 2–6 objects. Mercury through Neptune and the Moon are built in; other names/designations are looked up in SBDB. It shows:

- a variable-by-object comparison table, sortable by any row, with per-row min/max marks and reasons for missing values;
- semi-major axis, eccentricity, inclination, node, perihelion argument, period, q, Q, MOID in au/LD, H, diameter, albedo, rotation, present Sun/Earth distances, present heliocentric speed, mean speed, next Earth approach and orbit class;
- a top-down SVG orbit plot with Inner system / Fit all controls, distinct colour/dash/marker encodings, current positions and an au scale;
- an SVG scatter chart with independently selectable X/Y variables and linear/log controls;
- JPL versus computed source tags and an explicit two-body-position limitation.

## New files

- `proxy/jpl.js`
- `tests/jpl-route.test.mjs`
- `tests/jpl-model.test.mjs`
- `tests/jpl-kepler.test.mjs`
- `web/neo.html`
- `web/orbits.html`
- `web/styles/neo.css`
- `web/app/neo/model.js`
- `web/app/neo/charts.js`
- `web/app/neo/main.js`
- `web/app/orbits/kepler.js`
- `web/app/orbits/model.js`
- `web/app/orbits/charts.js`
- `web/app/orbits/main.js`
- `docs/codex-neo-orbits.md`

The supplied `tests/fixtures/jpl/**` files are task inputs and were not edited.

## Exact integration steps

### 1. Connect the relay

In `proxy/worker.js`, add this import beside the existing relay-route imports:

```js
import { jplRoute } from './jpl.js';
```

Then, inside `upstreamFor(url)`, immediately after `const p = url.pathname;`, add exactly:

```js
const jpl = jplRoute(url); if (jpl) return jpl;
```

The local server already uses `proxy/worker.js`, so no second server route is required. The mapper only accepts the five `/jpl/*` paths, validates query names per endpoint, caps values/query length, fixes the upstream host and returns a one-hour TTL (six hours for Sentry).

### 2. Add navigation links

Add built-page links to the existing desktop rail and phone Pages sheet:

```html
<a class="nav-btn" href="neo.html">Near-Earth</a>
<a class="nav-btn" href="orbits.html">Orbits</a>
```

Keep the current page's `aria-current="page"`. The new pages already link to Viewer, Near-Earth, Orbits and About.

### 3. Serve normally

No build step or dependency is required. Start the existing local server and open:

- `http://127.0.0.1:8787/neo.html`
- `http://127.0.0.1:8787/orbits.html`

## Verification

The offline tests parse the 14 November 2026 JPL fixtures and cover relay allow-listing/TTL, CAD/Sentry/SBDB normalization, H/albedo size bounds, Kepler's equation, Earth-like speed/distance, Ceres's period and Halley's eccentric orbit. Run all repository tests with:

```text
npm test
```

## Not tested live

- No live JPL request was made in this worktree; network behavior, current response volume and ambiguous live SBDB searches need an integrated relay smoke test.
- The main Viewer navigation was not edited because this task permits new files only.
- Browser layout, keyboard and dialog behavior should receive a final smoke test after the relay and nav integration.

## Known limits

- Current positions use two-body propagation from the supplied osculating elements. Perturbations are omitted, so this is a comparison view, not an observing ephemeris.
- Built-in planets use fixed J2000 elements from JPL/Standish without secular rates. The Moon uses standard mean geocentric J2000 elements added to the computed Earth position.
- CAD epochs are TDB. For this 2026 dashboard they are converted to approximate UTC using TDB−UTC = 69.184 seconds; the millisecond-scale periodic TDB−TT term is omitted.
- The orbit plot deliberately suppresses vertical tilt in the drawing; inclination remains in the table and the current-distance calculation uses 3D coordinates.
- Sentry entries describe modelled potential impacts, not predictions of certain impacts. The page keeps the official scale values and calm explanatory wording.
- Planet physical values are static catalogue values. H and Earth MOID are left unavailable where they are not meaningful rather than invented.
- `/jpl/sb_ident` and `/jpl/horizons` are allow-listed for later team pages but are not called by these two pages.

