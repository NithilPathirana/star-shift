<!-- AI-written (OpenAI Codex) for Star Shift, NASA Space Apps 2026 -->
# Lab notebook integration

The lab notebook is a standalone browser module. It stores multiple named notebooks locally, works from an in-memory copy when browser storage is blocked, and provides captured values, free notes, a seven-step hypothesis template, Markdown export and a printable dialog.

## Files

- `web/app/notebook/notebook.js` — public UI API and accessible dialog.
- `web/app/notebook/store.js` — localStorage-backed multi-notebook store.
- `web/app/notebook/template.js` — hypothesis field order and serialiser.
- `web/app/notebook/export.js` — Markdown and citation-block export.
- `web/styles/notebook.css` — dialog, + button, toast and print styles.
- `tests/jpl-notebook.test.mjs` — offline store and export tests.

## Wire the rail button

Load the stylesheet on every page:

```html
<link rel="stylesheet" href="styles/notebook.css">
```

Import the module from a page controller and connect the rail/top-bar button:

```js
import { notebookAdd, openNotebook, plusButton } from './notebook/notebook.js';

document.querySelector('#lab-notebook-button')
  .addEventListener('click', () => openNotebook());
```

The button should be a normal `.nav-btn` or `.key`, labelled `Lab notebook`. `openNotebook()` creates the dialog only on first use. The native dialog handles focus and Escape; the close button is keyboard accessible.

## Entry shape

```js
notebookAdd({
  label: 'RA motion',
  value: 12.4,
  unit: '″/h',
  uncertainty: 0.3,
  source: 'NASA/JPL SB Identification',
  tag: 'JPL',
  context: {
    page: 'Asteroid Spotter',
    ra: 269.4461,
    dec: 4.7707,
    date: '2026-03-15',
    frameId: '',
    url: location.href,
  },
});
```

Always put the unit beside a numeric value and use one of the page source tags (`OBSERVED`, `COMPUTED`, `CATALOGUE`, `JPL`). `url` must be the current shareable URL, including target, date/frame and tool state where those parameters exist.

## Attach + buttons

`plusButton(element, getEntry)` appends a small accessible + to `element` (or places it after a void element such as an input). `getEntry` runs at click time so it captures the current value rather than a stale render value.

### Details-panel rows

```js
plusButton(valueCell, () => ({
  label: row.label, value: row.value, unit: row.unit,
  uncertainty: row.uncertainty, source: row.source, tag: row.tag,
  context: { page: 'Viewer', ra: state.ra, dec: state.dec, date: frame.date, frameId: frame.id, url: location.href },
}));
```

### Motion values

```js
plusButton(motionValue, () => ({
  label: 'Measured motion', value: motion.arcsecPerHour, unit: '″/h',
  uncertainty: motion.uncertainty, source: 'SPHEREx time-lapse measurement', tag: 'COMPUTED',
  context: { page: 'Viewer', ra: state.ra, dec: state.dec, date: frame.date, frameId: frame.id, url: location.href },
}));
```

### Flag counts

```js
plusButton(flagCount, () => ({
  label: 'Flagged pixels', value: flags.count, unit: 'pixels', uncertainty: '',
  source: 'SPHEREx FLAGS extension', tag: 'OBSERVED',
  context: { page: 'Viewer', ra: state.ra, dec: state.dec, date: frame.date, frameId: frame.id, url: location.href },
}));
```

### Spectrum points

```js
plusButton(pointLabel, () => ({
  label: `Spectrum at ${point.wavelength} µm`, value: point.flux, unit: point.unit,
  uncertainty: point.uncertainty, source: 'SPHEREx spectrum', tag: 'OBSERVED',
  context: { page: 'Spectrum', ra: state.ra, dec: state.dec, date: point.date, frameId: point.frameId, url: location.href },
}));
```

### Archive rows

```js
plusButton(archiveValue, () => ({
  label: 'Archive observation', value: row.value, unit: row.unit, uncertainty: row.uncertainty,
  source: row.collection, tag: 'CATALOGUE',
  context: { page: 'Archive', ra: row.ra, dec: row.dec, date: row.date, frameId: row.id, url: row.shareUrl },
}));
```

Do not attach one + button on every cell in a dense table. Prefer the primary measured value or reveal the button when a row is selected, while keeping it keyboard reachable.
