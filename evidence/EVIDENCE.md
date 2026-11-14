# Evidence: data core on NASA's five test targets

Generated 2026-11-14T08:06:15.701Z by `node tools/prove_targets.mjs 60` with live IRSA data (images rendered by `tools/render_evidence.py`). AI-written code (Claude, Anthropic).

Cutouts 0.05° from IRSA, re-gridded to 150″ north-up frames (6.15″ pixels). Up to 60 frames per target, spread evenly over time (WISE 0855: all detector-5/6 frames). Bad pixels masked from the FLAGS bits (not on SOURCE pixels).

| Target | SPHEREx images found | per detector | first – last | visits | frames fetched (failed) |
|---|---|---|---|---|---|
| Barnard's Star | 358 | D1 60, D2 61, D3 59, D4 59, D5 61, D6 58 | 2025-08-15 – 2026-09-22 | 7 | 60 (0) |
| Epsilon Indi B | 458 | D1 46, D2 93, D3 96, D4 46, D5 84, D6 93 | 2025-04-24 – 2026-10-02 | 7 | 60 (0) |
| WISE 0855 | 258 | D1 36, D2 48, D3 45, D4 36, D5 48, D6 45 | 2025-05-05 – 2026-05-14 | 4 | 92 (1) |
| RW Aurigae | 335 | D1 56, D2 55, D3 56, D4 56, D5 56, D6 56 | 2025-09-01 – 2026-09-16 | 6 | 60 (0) |
| R Draconis | 2493 | D1 584, D2 89, D3 574, D4 584, D5 89, D6 573 | 2025-04-24 – 2026-09-27 | 19 | 60 (0) |

## Motion check (moving targets)

Star position measured on the median stack of each visit season, compared with SIMBAD proper motion propagated to the same dates.

| Target | seasons | span (yr) | measured shift | expected shift | direction measured / expected (° E of N) |
|---|---|---|---|---|---|
| Barnard's Star | 3 | 0.98 | 10.11″ (1.64 px) | 10.22″ (1.66 px) | -11.31 / -4.42 |
| Epsilon Indi B | 4 | 1.38 | 6.22″ (1.01 px) | 6.49″ (1.05 px) | 131 / 121.73 |
| WISE 0855 | 3 | 0.99 | 6.15″ (1 px) | 8.04″ (1.31 px) | -89.04 / -85.26 |

Single-frame cross-check (per-season mean of single-frame centroids, ±1σ):

- Barnard's Star: 9.98 ± 0.64″ vs 10.22″; straight-line fit μα* = -859 ± 628, μδ = 10061 ± 672 mas/yr (catalogue -802, 10362).
- Epsilon Indi B: 5.95 ± 0.31″ vs 6.49″; straight-line fit μα* = 3600 ± 204, μδ = -2591 ± 175 mas/yr (catalogue 3982, -2467).
- WISE 0855: 6.33 ± 0.76″ vs 8.04″; straight-line fit μα* = -5986 ± 1200, μδ = 1662 ± 738 mas/yr (catalogue -8124, 673).

## Notes

- **WISE 0855:** NASA's coordinates (epoch ~2010.45) are 121″ (20 px) from where it was at the first SPHEREx visit, so the tool must propagate positions. It is only visible at 3.8–5 µm (detectors 5–6); at short wavelengths a fixed background star ~1 px away dominates. Measured motion direction matches; size is ~75–80% of expected (faint, blended).
- **Epsilon Indi B** is a tight pair of brown dwarfs (unresolved by SPHEREx); measured shift within ~1σ–2σ.
- **RW Aurigae, R Draconis** (variables, not movers): per-frame brightness at the star is in `summary.json` → `lightCurve`. Each frame is at a different wavelength (linear variable filters), so brightness changes mix wavelength and time; compare like with like before calling it variability.
- **R Draconis** sits near the north ecliptic pole: 2,493 images over 19 visits (vs ~300 elsewhere).
- IRSA cutouts returned HTTP 503 often on 14 Nov; the core retries with back-off.

Files: `summary.json` (all numbers), `<target>_sheet.png` + `<target>.gif` (frames, red ring = predicted position that day), `stacks_<target>_sheet.png` (season stacks).
