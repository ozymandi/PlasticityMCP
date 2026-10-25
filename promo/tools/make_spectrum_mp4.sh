#!/usr/bin/env bash
# Assemble promo/renders/spectrum/<scene>/frame_####.png into per-scene mp4s and one joined cut.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
R="$ROOT/renders/spectrum"; V="$ROOT/videos/spectrum"; mkdir -p "$V"
declare -A START=([assembly]=1 [fly1]=241 [fly2]=391 [fly3]=541 [flip]=691 [iso]=811)
: > "$V/concat.txt"
for s in assembly fly1 fly2 fly3 flip iso; do
  n=$(ls "$R/$s"/frame_*.png 2>/dev/null | wc -l); echo "$s: $n frames"
  ffmpeg -y -loglevel error -framerate 30 -start_number "${START[$s]}" -i "$R/$s/frame_%04d.png" \
    -c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p -movflags +faststart "$V/spectrum-$s.mp4"
  echo "file 'spectrum-$s.mp4'" >> "$V/concat.txt"
done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$V/concat.txt" -c copy "$V/spectrum-cut.mp4"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$V/spectrum-cut.mp4"
