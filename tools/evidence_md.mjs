// Write evidence/EVIDENCE.md from evidence/summary.json.
// AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
import { readFileSync, writeFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(new URL('../evidence/summary.json', import.meta.url), 'utf8'));
const L = [];
L.push("# Evidence: data core on NASA's five test targets", '',
  `Generated ${s.generated} by \`node tools/prove_targets.mjs 60\` with live IRSA data (images by \`tools/render_evidence.py\`, this page by \`tools/evidence_md.mjs\`). AI-written code (Claude, Anthropic).`, '',
  `Cutouts ${s.cutoutSizeDeg}° from IRSA, re-gridded to ${s.gridArcsec}″ north-up frames (6.15″ pixels). Up to 60 frames per target, spread evenly over time (WISE 0855: all detector-5/6 frames). Bad pixels masked using the FLAGS bits (dead/missing only on SOURCE pixels).`, '',
  '| Target | SPHEREx images found | per detector | first – last | visits | frames fetched (failed) |', '|---|---|---|---|---|---|');
for (const t of s.targets)
  L.push(`| ${t.label} | ${t.imagesFound} | ${Object.entries(t.imagesPerDetector).sort().map(([k, v]) => k + ' ' + v).join(', ')} | ${t.firstDate} – ${t.lastDate} | ${t.visits.length} | ${t.framesFetched} (${t.framesFailed}) |`);
L.push('', '## Motion check (moving targets)', '',
  'Star position measured on the median stack of each visit season, compared with SIMBAD proper motion propagated to the same dates.', '',
  '| Target | seasons | span (yr) | measured shift | expected shift | direction measured / expected (° E of N) |', '|---|---|---|---|---|---|');
for (const t of s.targets) if (t.stackedFirstToLast) {
  const m = t.stackedFirstToLast;
  L.push(`| ${t.label} | ${t.stackedSeasons.length} | ${m.years} | ${m.measured_arcsec}″ (${m.measured_px} px) | ${m.expected_arcsec}″ (${m.expected_px} px) | ${m.direction_measured_deg} / ${m.direction_expected_deg} |`);
}
L.push('', 'Single-frame cross-check (per-season mean of single-frame centroids, ±1σ):', '');
for (const t of s.targets) if (t.motion?.firstToLastSeason) {
  const m = t.motion.firstToLastSeason, f = t.motion.lineFit_mas_per_yr;
  L.push(`- ${t.label}: ${m.measured_arcsec} ± ${m.measured_err_arcsec}″ vs ${m.expected_arcsec}″; straight-line fit μα* = ${f.pmra} ± ${f.pmra_err}, μδ = ${f.pmdec} ± ${f.pmdec_err} mas/yr (catalogue ${f.catalogue.map(Math.round).join(', ')}).`);
}
const w = s.targets.find(t => t.key === 'wise-0855');
L.push('', '## Notes', '',
  `- **WISE 0855:** NASA's coordinates (epoch ~2010.45) are ${w.nasaPositionOffsetArcsec.toFixed(0)}″ (${(w.nasaPositionOffsetArcsec / 6.15).toFixed(0)} px) from where it was at the first SPHEREx visit, so the tool must propagate positions. It is only visible at 3.8–5 µm (detectors 5–6); at short wavelengths a fixed background star ~1 px away dominates. Measured motion direction matches; size is ~75–80% of expected (faint, blended), so the site must not claim a precise proper motion for it.`,
  '- **Epsilon Indi B** is a tight pair of brown dwarfs (unresolved by SPHEREx); measured shift agrees within ~2σ.',
  '- **RW Aurigae, R Draconis** (variables, not movers): per-frame brightness at the star is in `summary.json` → `lightCurve`. Each frame is at a different wavelength (linear variable filters), so brightness changes mix wavelength and time; compare like with like before calling it variability.',
  '- **R Draconis** sits near the north ecliptic pole: 2,493 images over 19 visits (vs ~300 elsewhere).',
  '- IRSA cutouts returned HTTP 503 often on 14 Nov; the core retries with back-off.', '',
  'Files: `summary.json` (all numbers), `<target>_sheet.png` + `<target>.gif` (frames; red ring = predicted position that day), `stacks_<target>_sheet.png` (season stacks).');
writeFileSync(new URL('../evidence/EVIDENCE.md', import.meta.url), L.join('\n') + '\n');
console.log('wrote evidence/EVIDENCE.md');
