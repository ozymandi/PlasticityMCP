#!/usr/bin/env bash
# render all four steel shots: blender → RGBA png → composite over #161616
set -e
cd /e/Projects/PlasticityMCP/promo
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
S=${SAMPLES:-256}
declare -A GLASS=( [tt]="Extruded.008" )
for k in ${@:-nes tt cam bike}; do
  extra=""; [ -n "${GLASS[$k]}" ] && extra="--glass ${GLASS[$k]}"
  "$B" -b --factory-startup -P tools/blender_steel.py -- E:/Projects/PlasticityMCP/promo/assets/mesh/$k.obj E:/Projects/PlasticityMCP/promo/assets/steel/$k-rgba.png --samples $S --w 1920 --h 1080 $extra 2>&1 | grep -E "WROTE|Traceback|Error:" | tail -3
  ffmpeg -v error -y -f lavfi -i "color=c=0x161616:s=1920x1080" -i assets/steel/$k-rgba.png -filter_complex "[0][1]overlay=format=auto" -frames:v 1 assets/steel/$k-steel.png
  echo "done $k"
done
ffmpeg -v error -y -i assets/steel/nes-steel.png -i assets/steel/tt-steel.png -i assets/steel/cam-steel.png -i assets/steel/bike-steel.png -filter_complex "[0]scale=960:-1[a];[1]scale=960:-1[b];[2]scale=960:-1[c];[3]scale=960:-1[d];[a][b]hstack[t];[c][d]hstack[u];[t][u]vstack" assets/steel/contact.png && echo contact
