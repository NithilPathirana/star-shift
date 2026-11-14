<!-- AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026 -->
# Codex handoff: SPHEREx Asteroid Spotter

`web/neo.html` is now the SPHEREx-centred Asteroid Spotter. Its first tab identifies known asteroids and comets inside a requested field on supplied SPHEREx observation dates; its second tab contains the complete orbit-comparison workbench. `web/orbits.html` redirects to that tab.

## What changed

- `web/app/neo/sb-ident.js` builds strict JPL SB Identification parameters and parses its field-driven response tables.
- `web/app/neo/spotter.js` reads `ra`, `dec`, `fov`, `dates`, `from`, `to` and `tab` from the URL, runs asteroid and comet checks per distinct date, renders predictions and connects matches to the viewer and comparison tab.
- The default field is Barnard's Star (`269.4461`, `+4.7707`, `0.5°`) with survey-window mid-dates `2025-08-15`, `2026-03-15` and `2026-08-15`.
- The former NEO page is compact threat context: three calm summary cards, top 10 close approaches and top 10 Sentry rows. Every row still opens the SBDB drawer.
- The orbit table, orbit plot, scatter plot and 2–6-object selector now live inside `neo.html?tab=orbits`. A caught object's Add button triggers its SBDB lookup there.
- `tests/fixtures/jpl/sb_ident.json` is a hand-made fixture matching the documented JPL 1.1 `fields_second` / `data_second_pass` shape. `tests/jpl-sb-ident.test.mjs` covers parameter formatting, date normalisation, geocentric retry and parsing.

## Relay integration

In `proxy/worker.js`, import the route beside the other relay helpers:

```js
import { jplRoute } from './jpl.js';
```

Inside `upstreamFor(url)`, immediately after `const p = url.pathname;`, add:

```js
const jpl = jplRoute(url); if (jpl) return jpl;
```

`proxy/jpl.js` already allow-lists all SB Identification parameters used here, including `mpc-code`, `xobs`, FOV center/half-width, pass controls and `sb-kind`.

## Navigation integration

Replace separate Near-Earth and Orbits navigation entries with one built-page link:

```html
<a class="nav-btn" href="neo.html">Spotter</a>
```

Use `neo.html?tab=orbits` for any direct Compare orbits link. Existing `orbits.html` links remain safe because that file preserves query parameters and redirects.

## URL contract

Example:

```text
neo.html?ra=269.4461&dec=4.7707&fov=0.5&dates=2025-08-15,2026-03-15,2026-08-15&from=2026-01-01&to=2026-12-31
```

`fov` is the full square-field width in degrees; JPL receives half that value for both RA and Dec half-widths. Invalid/missing values fall back to the Barnard's Star defaults. Dates are deduplicated and validated as ISO calendar dates.

## Important JPL observer detail

The product brief requests geocentric `mpc-code=500`, so every check tries that form first. Current JPL documentation explicitly says code 500 is not a valid topocentric MPC code. On an HTTP failure, the Spotter retries the same request with the documented geocentric state-vector form `xobs=0,0,0,0,0,0`, retaining velocity components so motion can be returned. The visible status reports retries or both failure codes rather than showing an empty result as success.

## Verification and live limits

Run all offline tests with `npm test`. The parser is fixture-tested, but this worktree did not make live JPL calls. After the relay is connected, smoke-test at least one narrow field and confirm JPL still reports API version 1.1. SB Identification predicts catalogued visible-magnitude small bodies at a chosen timestamp; it does not prove that SPHEREx detected them, and a no-match result does not rule out uncatalogued objects. Positions and rates come from JPL; the orbit plot's current positions remain two-body approximations.
