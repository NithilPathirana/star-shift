#!/usr/bin/env bash
# Warm the local relay's map-tile cache for NASA's five targets: open each one in headless
# Edge so the map requests exactly the tiles a visitor would (default colour + colour bands).
# AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
E="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
for q in "Barnard%27s%20Star" "Epsilon%20Indi%20B" "WISE%200855" "RW%20Aurigae" "R%20Draconis"; do
  for extra in "" "&bands=on"; do
    "$E" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1366,900 \
      --virtual-time-budget=45000 --dump-dom "http://127.0.0.1:8787/?q=$q$extra" >/dev/null 2>&1
    echo "warmed $q$extra"
  done
done
