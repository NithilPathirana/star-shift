# Sky transmission curves (Atmosphere lens, DESIGN.md 31b)

`transmission.json` holds four real sky-transmission curves, made by `ATRAN` and published by
Gemini Observatory. Each value is the fraction of light that gets through the air (0 to 1),
box-averaged from the raw 0.00002 µm sampling into 0.01 µm bins centred on
`startUm + i * stepUm` (0.90, 0.91, … 5.10 µm). Values are clipped to 0–1 and rounded to 3 places.
Processed by Claude (Anthropic) for team Proper Motion, NASA Space Apps 2026, on 14 Nov 2026.

| key | site | site height | water vapour | airmass | raw file |
|---|---|---|---|---|---|
| `mk_16_10` | Mauna Kea | 4,213 m | 1.6 mm | 1.0 | https://www.gemini.edu/sciops/ObsProcess/obsConstraints/atm-models/mktrans_zm_16_10.dat |
| `cp_23_10` | Cerro Pachón | 2,722 m | 2.3 mm | 1.0 | https://www.gemini.edu/sciops/ObsProcess/obsConstraints/atm-models/cptrans_zm_23_10.dat |
| `cp_43_10` | Cerro Pachón | 2,722 m | 4.3 mm | 1.0 | https://www.gemini.edu/sciops/ObsProcess/obsConstraints/atm-models/cptrans_zm_43_10.dat |
| `cp_100_10` | Cerro Pachón | 2,722 m | 10.0 mm | 1.0 | https://www.gemini.edu/sciops/ObsProcess/obsConstraints/atm-models/cptrans_zm_100_10.dat |

Index page with the full table of files: https://www.gemini.edu/observing/telescopes-and-sites/sites
(section "IR Transmission Spectra"; file names give 10 × water vapour in mm and 10 × airmass).

**Citation (required by Gemini):** Lord, S. D., 1992, *A new software tool for computing Earth's
atmospheric transmission of near- and far-infrared radiation*, NASA Technical Memorandum 103957.
Data courtesy of Gemini Observatory.

## Coverage and gaps

- The raw curves run from 0.90 to 5.60 µm. **0.74–0.90 µm has no curve**; the page marks that part
  of the ruler as "no data" and does not invent values. The Starlight band (0.74–1.11 µm) is
  averaged over 0.90–1.11 µm only and carries a † on the page.

## Which curve each place uses (atmo.js `CURVE_FOR_HEIGHT`)

| place height | curve | label on the page |
|---|---|---|
| 3,500 m and up | Mauna Kea 1.6 mm | own curve for Mauna Kea; "approximate" elsewhere |
| 2,300–3,500 m (Paranal, La Silla, La Palma) | Cerro Pachón 2.3 mm | approximate, borrowed |
| 1,000–2,300 m (Kitt Peak, Palomar, …) | Cerro Pachón 4.3 mm | approximate, borrowed |
| below 1,000 m or unknown (Colombo, NASA centres, typed coordinates) | Cerro Pachón 10 mm, the wettest | approximate; real humid sea-level air holds more water, so it blocks more |

Borrowed curves are used as is, not rescaled: water, CO₂ and ozone absorption are mixed in one
curve and cannot be separated, so a simple water-vapour scaling would be wrong at the CO₂ band.

## The "blocked" rule

Mean transmission across a band (looking straight up): under 20% = **blocked**, 20–80% =
**partly**, 80% or more = open.
