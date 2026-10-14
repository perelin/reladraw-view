// Run as `sh -c RENDER_SCRIPT reladraw-view <cache key> <theme or "">`, the
// diagram source on stdin. Prints "<width> <height>" (the SVG's px) and then
// the PNG's absolute path. The SVG stays beside the PNG so a cached diagram
// still yields its size.
export const RENDER_SCRIPT = `
set -eu
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
dir="$HOME/Library/Caches/reladraw-view"
mkdir -p "$dir"
svg="$dir/$1.svg"
png="$dir/$1.png"
if [ ! -s "$png" ] || [ ! -s "$svg" ]; then
  if [ -n "$2" ]; then
    reladraw /dev/stdin -o "$svg" --theme "$2"
  else
    reladraw /dev/stdin -o "$svg"
  fi
  rsvg-convert -z 2 -o "$png.tmp" "$svg"
  mv "$png.tmp" "$png"
fi
size=$(head -c 2000 "$svg" | tr '\\n' ' ' | sed -n 's/^[^>]*width="\\([0-9.]*\\)"[^>]*height="\\([0-9.]*\\)".*/\\1 \\2/p')
printf '%s\\n%s\\n' "$size" "$png"
`
