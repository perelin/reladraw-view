// Run as `sh -c RENDER_SCRIPT reladraw-view <cache key> <theme or "">`, the
// diagram source on stdin. Prints "<width> <height>" (the SVG's px) and then
// the PNG's absolute path. The SVG stays beside the PNG so a cached diagram
// still yields its size.
//
// reladraw's CLI changed from `reladraw <file>` to `reladraw render <file>`
// after 0.16, so the form is picked from its --help. The reladraw version is
// part of the cached file names: an upgrade can draw the same source
// differently, and a picture from the old version must not be reused.
// The source goes through a file, not /dev/stdin: on Linux a Node-spawned
// process gets a socket as stdin, and reladraw cannot open /dev/stdin then.
export const RENDER_SCRIPT = `
set -eu
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
case "$(uname -s)" in
  Darwin) dir="$HOME/Library/Caches/reladraw-view" ;;
  *) dir="\${XDG_CACHE_HOME:-$HOME/.cache}/reladraw-view" ;;
esac
mkdir -p "$dir"
version=$(reladraw --version 2>/dev/null | tr -cd '0-9A-Za-z.' || true)
name="$1-\${version:-unknown}"
src="$dir/$name.reladraw"
svg="$dir/$name.svg"
png="$dir/$name.png"
if [ ! -s "$png" ] || [ ! -s "$svg" ]; then
  trap 'rm -f "$src" "$svg.tmp.svg" "$png.tmp"' EXIT
  if reladraw --help 2>&1 | grep -q 'reladraw render'; then
    command=render
  else
    command=
  fi
  cat > "$src"
  # reladraw reports findings and the written path; stdout is our answer.
  if [ -n "$2" ]; then
    reladraw $command "$src" -o "$svg.tmp.svg" --theme "$2" >&2
  else
    reladraw $command "$src" -o "$svg.tmp.svg" >&2
  fi
  mv "$svg.tmp.svg" "$svg"
  rsvg-convert -z 2 -o "$png.tmp" "$svg"
  mv "$png.tmp" "$png"
fi
size=$(head -c 2000 "$svg" | tr '\\n' ' ' | sed -n 's/^[^>]*width="\\([0-9.]*\\)"[^>]*height="\\([0-9.]*\\)".*/\\1 \\2/p')
printf '%s\\n%s\\n' "$size" "$png"
`
