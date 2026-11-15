# NASA spacesuit model: where it came from

Downloaded by the Design Studio session (Claude) for loader v7. Approved by Nithil in the Design Studio chat on Sun 15 Nov 2026 ("I approve the download").

| | |
|---|---|
| Model | Extravehicular Mobility Unit (EMU) |
| Page | https://science.nasa.gov/3d-resources/extravehicular-mobility-unit/ |
| File URL | https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/model/extravehicular-mobility-unit/Extravehicular%20Mobility%20Unit.glb |
| Also listed at | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Extravehicular%20Mobility%20Unit |
| File name | `Extravehicular Mobility Unit.glb` |
| Size | 3,448,904 bytes (3.29 MB) |
| SHA-256 | `4dd79f1f8e02ab39bc15d87a7bbeda1f437e1103ab7661f7797340e0c114f372` |
| Downloaded | 2026-11-15 15:43 Sri Lanka time, from NASA's own server only |
| Kept in | `design/loader/v5c/src/` (nothing else is in that folder) |

## What is in it (opened in Blender 5.2, `tools/inspect_emu.py`, `tools/inspect_emu2.py`)
- One mesh, 442,172 points, 25 materials, no skeleton, no animation. The mesh is in 56,925 separate little pieces, so it has no ready-made limbs to turn.
- The suit is shown with the big manoeuvring backpack and its two hand-controller arms, floating with slightly bent legs and arms forward.
- Three texture images, all to be removed or replaced before any render is published:
  - `emusuitFLAGpatch` (582×564): a United States flag. Used by two materials.
  - `emusuitvitruvianpatch` (582×564): a mission-style patch with an astronaut figure. Used by one material.
  - `emusuitbox4` (1000×1032): chest-box lettering ("EVA PRESS", a dial).

## Rules for using it (Master, from Submission Check, Sun 15 Nov)
- The final render must show no NASA worm or meatball, no flag, no name tape, no mission patch.
- Caption credit: "Spacesuit model: NASA 3D Resources (public domain), modified". The baked mark stays "Animation: SI-generated (made by Claude in Blender)".
- Nothing may suggest that NASA endorses the project.
- A v7 loader swap is allowed until 23:59 on Sun 15 Nov, not after.

## What was changed for loader v7 (`tools/emu_prep.py`, Sun 15 Nov 2026, about 16:00)
- Every one of the model's 25 materials and all three texture images are deleted after import (the script prints "images left 0"). The flag, the patch and the chest lettering therefore cannot render. The parts get the loader scene's own materials: white suit fabric, white shell, navy, blue and neon yellow, a gold mirror visor.
- The head inside the helmet (material `lambert3SG`, 6,400 faces) is deleted. The rider is faceless.
- The two shoulder panels that carried the flag and the patch are plain blue. The red stripes are neon yellow.
- The shape is not re-posed (the model has no skeleton). It is scaled to 0.85 and stands in a hatch on the v6 rocket, cut off just above the knee by the hull, with the manoeuvring unit's hand controllers in its hands.
- Checked by eye on preview frames 61, 121 and 181 and a close crop of the chest: no logo, flag, name tape, lettering or patch is visible.

## NASA's media usage guidelines (read Sun 15 Nov 2026, 16:06, https://www.nasa.gov/nasa-brand-center/images-and-media/)
- 3D model data is "generally … not subject to copyright in the United States" and may be used for educational or informational purposes, including computer graphics and web pages.
- NASA should be acknowledged as the source: the credit line above does that.
- Use must not imply NASA's endorsement, and NASA's insignia (meatball, worm, seal) must not appear with SI-generated imagery: none appears.
- For SI products NASA allows a factual statement that NASA source material is included, as long as no review or permission by NASA is implied, and encourages a visible SI-generated marking: the baked mark stays on every frame.
- Nobody may claim copyright in NASA material: the project's licence must not claim the suit model as the team's own work.
- Wording note: NASA's own phrase is "not subject to copyright in the United States"; the credit line says "public domain" as Submission Check asked.
