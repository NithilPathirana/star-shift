# Work order 7: short DESIGN.md specs

**DONE Sat 14 Nov 21:43.** Nithil changed the plan (~21:40): use the remaining usage now, do not wait for 03:30. Written as DESIGN.md sections 25–30: 25 shared rules, 26 planetarium, 27 Motion panel (K), 28 Observation Archive, 29 Spectral Explorer, 30 style notes for I and J (Codex builds those two). The 03:37 wake-up was cancelled. The text below is the original order, kept for the record.

From the Master Session, Sat 14 Nov (two messages, ~21:30 and ~21:35). Not started: Claude's weekly usage was at 91% and resets at 03:30, so this waits until then. Text specs only, no renders, no prototype unless asked. Stay in the Star Shift style (DESIGN.md sections 0-11).

**Order confirmed by the Master Session at ~21:36: planetarium → I → K → J → Archive → Spectral.** (K before J; the numbering of the list below is the original message's, not the order to write in.)
First confirm with `get_usage` that the weekly limit has reset; if it has not, write nothing and tell the Master Session.

Write short sections in DESIGN.md, (continue the numbering from section 24):

1. **Planetarium view.** Team's words: "Live location based sky and all the asteroids moon and suns and planets whatever we can see - option to take the night sky of major laboratories also and NASA centers also and enter coordinates to located that sky too". Master: live-location planetarium with observatory and NASA-centre presets, Sun, Moon, planets and asteroids. Builds on section 16 (observer location) and section 18 (3D sky).
2. **I. "Astronomical Threat Intelligence System".** A near-Earth-object dashboard: serious, calm, no alarmism; clear scales such as Palermo and Torino; distance in lunar distances.
3. **J. Orbit comparison.** A table, an inner Solar System orbit plot, and a scatter chart with selectable axes.
4. **K. Motion panel.** Angular, proper and orbital velocity, each with its source.
5. Then, from the earlier message: **Observation Archive** table and **Spectral Explorer**. (The Methodology page was listed as a feature but no spec was asked for.)

Before writing:
- Read `05 Idea – team decides.md` (Obsidian vault, Space Apps 2026) for the team's own wording, and check what Coding has already built in `C:\SpaceApps2026\web\` so the spec matches the build. Coding has the full feature list.
- Do not invent features, data or audience (SI rule). Where the data may not exist, say "show only if the data is there".
- Kurucharan's reference board is a layout reference only: no "SPHEREx Observatory" logo, no NASA branding.
- JPL labels for Solar System objects and "velocity for any star" are on Coding's list too; cover them inside the sections above where they belong.

When done: message Coding (`local_fd8924eb-5902-4ac2-9107-de5d7b386144`) with the section numbers and the points most likely to trip the build, add a line to `06 Status board.md`, and review anything already live.
