#!/usr/bin/env bash
# Final Cycles render of both promo scenes on this machine: PNG sequences only, one folder per shot
# (renders/surfacing/final/<shot>/frame_####.png). No video file is made — the sequences go to
# After Effects as they are (Designer's word, 2026-11-20).
# Resumable: run it again after a stop and finished frames are skipped. Empty placeholders of
# frames that were cut off are removed first, so they get rendered again.
#   powershell -ExecutionPolicy Bypass -File promo/tools/render_final.ps1   (keeps Windows awake)
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"          # promo/
BL="/c/Program Files/Blender Foundation/Blender 5.3/blender.exe"
OUT="$HERE/renders/surfacing/final"
LOG="$OUT/render.log"
mkdir -p "$OUT"
find "$OUT" -name "frame_*.png" -size 0 -delete 2>/dev/null
echo "=== render_final start $(date '+%F %T')" >> "$LOG"
for scene in maserati cube; do
  "$BL" -b "$HERE/blender/$scene.blend" --python "$HERE/tools/render_shots.py" -- "$OUT" 2>&1 \
    | grep --line-buffered -E "^SHOT|Error|error|Traceback|EXCEPTION|out of memory" >> "$LOG"
done
# count what landed: every shot folder must hold its whole frame range, no empty files
for d in "$OUT"/maserati_* "$OUT"/cube_*; do
  [ -d "$d" ] || continue
  n=$(find "$d" -name "frame_*.png" -size +0 | wc -l)
  z=$(find "$d" -name "frame_*.png" -size 0 | wc -l)
  echo "COUNT $(basename "$d") $n frames, $z empty" >> "$LOG"
done
echo "=== render_final end $(date '+%F %T')" >> "$LOG"
