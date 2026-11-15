// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
//
// "Report this find" pack for Spot (design/spec-team-extras.md, item 4). Pure functions: main.js
// gathers the suspect, its seasons and its checks; this file builds the JSON report, the full
// Markdown report, a short Backyard Worlds post and plain MPC-style observation notes.
// Star Shift never sends any of it: the person copies or downloads it and decides where it goes.

import { cutoutUrl, IRSA } from '../../core/irsa.js';
import { mjdToDate } from '../../core/motion.js';
import { formatRA, formatDec } from '../query.js';
import { REPORT_LINKS, DOIS, checkTitle, STATE_WORD } from './logic.js';

export const REPORT_SCHEMA = 'star-shift-spot-report/1';
export const CAVEAT = 'Most finds like this turn out to be known objects or artefacts: a star the catalogues list under a different position, a detector ghost, a cosmic-ray hit or noise. Volunteers and professionals check every report, and a quiet or "already known" answer is normal.';
// How to report, per place (shown on the page and copied into the Markdown report).
export const HOW_TO = [
  { ...REPORT_LINKS[0], key: 'byw',
    steps: 'Sign in to Zooniverse, open the project\'s Talk forum and search it for these coordinates first. If nobody has posted it, start a thread and paste "Copy for Backyard Worlds".' },
  { ...REPORT_LINKS[1], key: 'mpc',
    steps: 'The MPC accepts reports only in its own formats (ADES or the 80-column format), normally from observers with an observatory code. Use "Copy in MPC-style notes" to check the position against known objects with the MPC\'s own tools, or to pass it to someone who reports to the MPC.' },
];

const f6 = (v) => +(+v).toFixed(6);
const sexRA = (ra) => formatRA(ra).replace(/[hms]/g, '').replace(/\s+/g, ' ').trim();
const sexDec = (dec) => formatDec(dec).replace(/[°′″]/g, '').replace('−', '-').replace(/\s+/g, ' ').trim();
const isoDay = (mjd) => mjdToDate(mjd).toISOString().slice(0, 10);
const isoUtc = (mjd) => mjdToDate(mjd).toISOString().slice(0, 19) + 'Z';
// MPC-style date: "2025 09 20.12345" (UTC, decimal day)
export function mpcDate(mjd) {
  const d = mjdToDate(mjd), frac = (mjd - Math.floor(mjd)); // MJD days start at 0h UTC
  const day = (d.getUTCDate() + frac).toFixed(5).padStart(8, '0');
  return `${d.getUTCFullYear()} ${String(d.getUTCMonth() + 1).padStart(2, '0')} ${day}`;
}
const pos = (p) => (p ? { ra: f6(p.ra), dec: f6(p.dec), sexagesimal: `${formatRA(p.ra)} ${formatDec(p.dec)}` } : null);

// The IRSA cutout URL the app fetched for a frame (data.js loadFrame: same centre and size), on IRSA itself
// rather than the local relay. null when the frame has no cutout details.
export function imageLink(frame) {
  try { return frame?.uri && frame.cut ? cutoutUrl(frame.uri, frame.cut.ra, frame.cut.dec, frame.cut.size, IRSA) : null; } catch { return null; }
}

// A Star Shift address that reopens the same field and places the same ring.
// field: { key, query? } (key 'q' = a typed search: query { type: 'name', name } or { type: 'coords', ra, dec }).
export function shareLink(pageHref, field, ring, on = 0) {
  const u = new URL('spot.html', pageHref);
  let q;
  if (field?.key && field.key !== 'q') q = `field=${encodeURIComponent(field.key)}`;
  else if (field?.query?.type === 'name') q = `q=${encodeURIComponent(field.query.name)}`;
  else { const c = field?.query?.type === 'coords' ? field.query : ring; q = `ra=${(+c.ra).toFixed(5)}&dec=${(+c.dec).toFixed(5)}`; }
  return `${u.origin}${u.pathname}?${q}&click=${(+ring.ra).toFixed(6)},${(+ring.dec).toFixed(6)}${on ? '&on=latest' : ''}`;
}

// The dot's shift between the first and last epoch with a measured position (arcsec, arcsec/yr). Rough:
// dot centres on 6.15″ pixels of season stacks.
export function motionBetween(epochs) {
  const got = epochs.filter(e => e.position);
  if (got.length < 2) return null;
  const a = got[0], b = got[got.length - 1], years = (b.mjd - a.mjd) / 365.25;
  if (!(years > 0)) return null;
  let dra = b.position.ra - a.position.ra; if (dra > 180) dra -= 360; if (dra < -180) dra += 360;
  const cosd = Math.cos(((a.position.dec + b.position.dec) / 2) * Math.PI / 180);
  const east = dra * cosd * 3600, north = (b.position.dec - a.position.dec) * 3600, total = Math.hypot(east, north);
  return { from: a.label, to: b.label, years: +years.toFixed(3), eastArcsec: +east.toFixed(2), northArcsec: +north.toFixed(2),
    totalArcsec: +total.toFixed(2), arcsecPerYear: +(total / years).toFixed(2) };
}

// in: { field { key, label, query?, centre {ra,dec} }, suspect { n, ra, dec, on }, epochs: [{ label, mjd, startMjd,
// endMjd, found {ra,dec}|null, frames: [{ obsid, mjd, date, detector, wavelengthUm, uri, cut }] }], lines: checklist
// lines, verdict { kind, title, sub }, colour { text, ratio }|null, pageHref, made (Date) }
export function buildReport(inp) {
  const practice = inp.verdict?.kind !== 'unexplained';
  const epochs = inp.epochs.map(e => {
    const fr = e.frames || [], dets = [...new Set(fr.map(f => Number(f.detector)).filter(Number.isFinite))].sort((a, b) => a - b);
    const bands = dets.map(d => { const w = fr.filter(f => Number(f.detector) === d).map(f => f.wavelengthUm).filter(Number.isFinite);
      return { detector: d, wavelengthUm: w.length ? [+Math.min(...w).toFixed(3), +Math.max(...w).toFixed(3)] : null }; });
    const mjds = fr.map(f => f.mjd).filter(Number.isFinite);
    return {
      label: e.label, mjd: +e.mjd.toFixed(5), utc: isoUtc(e.mjd),
      mjdStart: +(e.startMjd ?? Math.min(...mjds)).toFixed(5), mjdEnd: +(e.endMjd ?? Math.max(...mjds)).toFixed(5),
      position: pos(e.found), positionNote: e.found ? 'measured centre of the dot in this season\'s stacked picture' : 'no clear dot within 2 pixels of the ring',
      imageCount: fr.length, detectors: dets, bands,
      images: fr.map(f => ({ obsid: f.obsid, mjd: +(+f.mjd).toFixed(5), utc: f.date ? String(f.date).slice(0, 19) + 'Z' : isoUtc(f.mjd), detector: Number(f.detector), wavelengthUm: Number.isFinite(f.wavelengthUm) ? +f.wavelengthUm.toFixed(3) : null, url: imageLink(f) })),
    };
  });
  return {
    schema: REPORT_SCHEMA, made: (inp.made || new Date()).toISOString(),
    practice, purpose: practice ? `Practice report: Star Shift's checks explained this suspect (${inp.verdict?.title || 'no verdict'}), so there is nothing to report.` : 'None of Star Shift\'s four checks explains this suspect; worth a second look.',
    field: { key: inp.field.key, label: inp.field.label, centre: pos(inp.field.centre) },
    suspect: { number: inp.suspect.n, ring: pos(inp.suspect), clickedOn: inp.suspect.on ? 'latest season' : 'first season' },
    epochs, motion: motionBetween(epochs.map(e => ({ ...e, position: e.position && { ra: e.position.ra, dec: e.position.dec } }))),
    checks: inp.lines.map(l => ({ id: l.id, title: checkTitle(l.id), status: l.status, result: STATE_WORD[l.status], text: l.text || '' })),
    colour: inp.colour ? { estimate: inp.colour.text, ratio: inp.colour.ratio || null, note: 'Supporting evidence only; never part of the verdict.' } : null,
    verdict: { kind: inp.verdict?.kind || 'pending', title: inp.verdict?.title || '', sub: inp.verdict?.sub || '' },
    shareLink: shareLink(inp.pageHref, inp.field, inp.suspect, inp.suspect.on),
    howToReport: HOW_TO.map(h => ({ name: h.name, url: h.href, forWhat: h.forWhat, steps: h.steps })),
    caveat: CAVEAT,
    autoSubmitted: false,
    credits: `NASA SPHEREx data via IRSA: ${DOIS}. Catalogues: Gaia DR3, SIMBAD, JPL Small-Body Identification. Made with Star Shift.`,
    coordinates: 'ICRS (J2000), degrees; sexagesimal for reading',
  };
}

const bandText = (e) => e.bands.map(b => `${b.detector}${b.wavelengthUm ? ` (${b.wavelengthUm[0].toFixed(2)}–${b.wavelengthUm[1].toFixed(2)} µm)` : ''}`).join(', ');
const posText = (p) => (p ? `RA ${formatRA(p.ra)}, Dec ${formatDec(p.dec)} (${p.ra.toFixed(6)}, ${p.dec >= 0 ? '+' : ''}${p.dec.toFixed(6)} deg)` : 'no clear dot');
const motionText = (m) => (m ? `The dot's centre shifts ${m.totalArcsec}″ (${m.eastArcsec >= 0 ? m.eastArcsec + '″ east' : -m.eastArcsec + '″ west'}, ${m.northArcsec >= 0 ? m.northArcsec + '″ north' : -m.northArcsec + '″ south'}) from the ${m.from.toLowerCase()} to the ${m.to.toLowerCase()}, ${m.years} years apart: about ${m.arcsecPerYear}″ a year. Rough: measured on 6.15″ pixels.` : 'No motion measured: the dot is not clear in two seasons.');

// The full report, Markdown (also reads as plain text).
export function reportMarkdown(r) {
  const L = [];
  L.push(`# Star Shift report: suspect ${r.suspect.number}, ${r.field.label}`);
  if (r.practice) L.push('', `> ${r.purpose.replace(/^Practice report: /, '**Practice report.** ')}`);
  L.push('', `**Verdict:** ${r.verdict.title}${r.verdict.sub ? ` (${r.verdict.sub})` : ''}`, '', `_${r.caveat}_`);
  L.push('', '## Position (ICRS, J2000)', `- Ring: ${posText(r.suspect.ring)}, placed on the ${r.suspect.clickedOn}`, `- Field centre: ${posText(r.field.centre)}`);
  L.push('', '## Epochs', '| Epoch | Middle MJD | Dates (UTC) | RA, Dec of the dot | Images | Detectors (bands) |', '|---|---|---|---|---|---|');
  for (const e of r.epochs) L.push(`| ${e.label} | ${e.mjd.toFixed(5)} | ${isoDay(e.mjdStart)} to ${isoDay(e.mjdEnd)} | ${e.position ? `${e.position.ra.toFixed(6)}, ${e.position.dec >= 0 ? '+' : ''}${e.position.dec.toFixed(6)}` : 'no clear dot'} | ${e.imageCount} | ${bandText(e)} |`);
  L.push('', motionText(r.motion));
  L.push('', '## Checks');
  for (const c of r.checks) L.push(`- ${c.title}: **${c.result}**. ${c.text}`);
  if (r.colour) L.push(`- Colour (estimate): ${r.colour.estimate}${r.colour.ratio ? ` (${r.colour.ratio})` : ''}. ${r.colour.note}`);
  L.push('', '## Reopen in Star Shift', r.shareLink);
  L.push('', '## Images (IRSA cutouts the app used, FITS)');
  for (const e of r.epochs) {
    L.push(`### ${e.label}`);
    for (const im of e.images) L.push(`- ${im.obsid}, MJD ${im.mjd.toFixed(5)}, detector ${im.detector}${im.wavelengthUm ? `, ${im.wavelengthUm.toFixed(2)} µm` : ''}${im.url ? `: ${im.url}` : ''}`);
  }
  L.push('', '## Where and how to report (Star Shift never sends anything itself)');
  for (const h of r.howToReport) L.push(`- [${h.name}](${h.url}), ${h.forWhat}. ${h.steps}`);
  L.push('', r.credits);
  return L.join('\n');
}

// A short post in Backyard Worlds' Talk style: plain, friendly, the facts a volunteer needs to look.
export function bywText(r) {
  const L = [];
  if (r.practice) L.push(`[Practice only: Star Shift explained this one as "${r.verdict.title}". Please don't post it.]`, '');
  L.push(`Possible mover in NASA SPHEREx images (${r.field.label} field)`);
  L.push(`Position: ${posText(r.suspect.ring)}, J2000`);
  for (const e of r.epochs) L.push(`${e.label}, ${isoDay(e.mjdStart)} to ${isoDay(e.mjdEnd)} (MJD ${e.mjd.toFixed(2)}): ${e.position ? `dot at ${e.position.ra.toFixed(5)}, ${e.position.dec >= 0 ? '+' : ''}${e.position.dec.toFixed(5)}` : 'no clear dot'}`);
  if (r.motion) L.push(`Shift: about ${r.motion.totalArcsec}″ in ${r.motion.years} yr (~${r.motion.arcsecPerYear}″/yr, rough: 6.15″ pixels)`);
  L.push(`What I checked in Star Shift: ${r.checks.map(c => `${c.title.toLowerCase()}: ${c.result.toLowerCase()}`).join('; ')}.`);
  if (r.colour) L.push(`Colour (rough estimate): ${r.colour.estimate}${r.colour.ratio ? ` (${r.colour.ratio})` : ''}`);
  L.push(`SPHEREx images: ${r.epochs.map(e => e.images[0]?.obsid).filter(Boolean).join(', ')} (first image of each season)`);
  L.push(`Reopen and blink it: ${r.shareLink}`);
  L.push('', 'I know most of these turn out to be known objects or artefacts, so any second look is welcome. #SPHEREx #mover');
  return L.join('\n');
}

// Plain observation notes, MPC-like in what they hold. NOT the MPC 80-column format.
export function mpcNotes(r) {
  const L = [];
  L.push('OBSERVATION NOTES (plain list; this is NOT the MPC 80-column or ADES format)');
  if (r.practice) L.push(`PRACTICE ONLY: Star Shift explained this suspect as "${r.verdict.title}". Not for reporting.`);
  L.push(`Object:      unidentified suspect ${r.suspect.number}, Star Shift field "${r.field.label}"`);
  L.push('Telescope:   NASA SPHEREx (space telescope, low Earth orbit); no MPC observatory code given here');
  L.push('Positions:   ICRS (J2000), dot centre in each season\'s stacked picture (median of that season\'s images), 6.15″ pixels');
  L.push('Dates:       UTC; the middle of each season\'s images (a season spans weeks, so an MPC report needs the single images below)');
  L.push('');
  L.push('Epoch            Date (UTC, decimal day)  RA (h m s)    Dec (d m s)    Images  Detectors');
  for (const e of r.epochs) {
    const p = e.position;
    L.push(`${e.label.padEnd(16)} ${mpcDate(e.mjd).padEnd(24)} ${(p ? sexRA(p.ra) : '--').padEnd(13)} ${(p ? sexDec(p.dec) : 'no clear dot').padEnd(14)} ${String(e.imageCount).padEnd(7)} ${e.detectors.join(',')}`);
  }
  L.push('');
  L.push(`Ring placed at: ${sexRA(r.suspect.ring.ra)} ${sexDec(r.suspect.ring.dec)} (${r.suspect.clickedOn})`);
  if (r.motion) L.push(`Shift:          ${r.motion.totalArcsec}″ in ${r.motion.years} yr (rough)`);
  L.push(`Checks:         ${r.checks.map(c => `${c.title}: ${c.result}`).join('; ')}`);
  L.push('');
  L.push('Single images (obsid, UTC date as decimal day, detector):');
  for (const e of r.epochs) for (const im of e.images) L.push(`  ${im.obsid}  ${mpcDate(im.mjd)}  det ${im.detector}`);
  L.push('');
  L.push(`Reopen: ${r.shareLink}`);
  L.push(r.credits);
  return L.join('\n');
}

export const reportFileName = (r) => `star-shift-report-${String(r.field.key || 'field').replace(/[^\w-]+/g, '-')}-suspect-${r.suspect.number}.json`;
