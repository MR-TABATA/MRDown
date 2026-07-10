#!/usr/bin/env bash
# Turns Playwright's raw VP8 capture into what the landing page actually serves:
# a small VP9 WebM, an H.264 MP4 for Safari, a poster frame, and the og:image.
#
#   demo/encode.sh
#
# GIF is deliberately not produced: 256 colours band badly on the dark UI, and a
# 20s GIF is an order of magnitude larger than the same clip as VP9.

set -euo pipefail
cd "$(dirname "$0")/.."

OUT=demo/out
MEDIA=docs/media
POSTER_AT=6 # a frame where the document is rendered and the cursor is at rest

mkdir -p "$MEDIA"

for lang in ja en; do
  src="$OUT/demo-$lang.webm"
  [ -f "$src" ] || { echo "missing $src — run: node demo/record.mjs --lang=$lang" >&2; exit 1; }

  ffmpeg -v error -y -i "$src" \
    -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 -pix_fmt yuv420p -an \
    "$MEDIA/demo-$lang.webm"

  ffmpeg -v error -y -i "$src" \
    -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart -an \
    "$MEDIA/demo-$lang.mp4"

  ffmpeg -v error -y -ss "$POSTER_AT" -i "$src" -frames:v 1 -q:v 3 \
    "$MEDIA/demo-$lang.jpg"
done

# Social cards want 1200x630. Letterbox rather than crop, so no UI is cut off.
ffmpeg -v error -y -ss "$POSTER_AT" -i "$OUT/demo-ja.webm" -frames:v 1 \
  -vf "scale=1200:630:force_original_aspect_ratio=decrease,pad=1200:630:(ow-iw)/2:(oh-ih)/2:color=#1e1e1e" \
  -q:v 3 "$MEDIA/og-image.jpg"

ls -la "$MEDIA"
