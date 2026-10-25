#!/usr/bin/env bash
# Re-render the preview proxy of "Spectrum composite" after editing inside it.
# aerender writes a TIFF sequence (~1 min), ffmpeg packs it into intra-frame H.264. AE keeps the current proxy file
# open, so each run writes a NEW file (timestamped) — relink it with footage.set_proxy (or File > Set Proxy) and delete
# the old ones once AE has let go of them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P="$ROOT/ae/proxy"; mkdir -p "$P/tif"
OUT="$P/spectrum-composite-proxy-$(date +%Y%m%d-%H%M%S).mp4"
if [ -z "$(ls "$P/tif" 2>/dev/null)" ] || [ "${1:-}" != "--reuse-tif" ]; then
  rm -rf "$P/tif"; mkdir -p "$P/tif"
  "/c/Program Files/Adobe/Adobe After Effects 2026/Support Files/aerender.exe" \
    -project "$(cygpath -w "$ROOT/ae/spectrum-cut.aep")" -comp "Spectrum composite" \
    -RStemplate "Best Settings" -OMtemplate "TIFF Sequence with Alpha" \
    -output "$(cygpath -w "$P/tif/comp_[####].tif")" -mfr ON 90 > "$P/aerender.log" 2>&1
fi
ffmpeg -y -loglevel error -framerate 30 -start_number 0 -i "$P/tif/comp_%04d.tif" \
  -c:v libx264 -preset fast -crf 15 -x264-params keyint=1 -pix_fmt yuv420p -movflags +faststart "$OUT"
rm -rf "$P/tif"
echo "$OUT"
