export type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'diagram'; source: string; raw: string }

export const MAX_SOURCE_LENGTH = 20_000

const OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*reladraw[ \t]*$/i

export const hasDiagramFence = (text: string): boolean =>
  text.split('\n').some(line => OPEN.test(line.replace(/\r$/, '')))

// A fence still open at the end (a reply mid-stream) stays markdown, so it is
// only rendered once Claude has written all of it.
export function splitSegments(text: string): Segment[] {
  const lines = text.split('\n')
  const segments: Segment[] = []
  let markdown: string[] = []

  const flush = () => {
    if (markdown.length > 0) {
      segments.push({ kind: 'markdown', text: markdown.join('\n') })
      markdown = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fence = OPEN.exec(line.replace(/\r$/, ''))?.[2]
    if (!fence) {
      markdown.push(line)
      continue
    }

    const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`)
    const end = lines.findIndex((line, j) => j > i && close.test(line.replace(/\r$/, '')))
    if (end === -1) {
      markdown.push(...lines.slice(i))
      break
    }

    const source = lines.slice(i + 1, end).join('\n')
    const raw = lines.slice(i, end + 1).join('\n')
    if (source.trim() === '' || source.length > MAX_SOURCE_LENGTH) {
      markdown.push(raw)
    } else {
      flush()
      segments.push({ kind: 'diagram', source, raw })
    }
    i = end
  }

  flush()
  return segments.filter(s => s.kind === 'diagram' || s.text.trim() !== '')
}

// `--theme` overrides the file, so it is only a default for sources without one.
export const themeFor = (source: string, fallback: string): string =>
  /^\s*diagram\b.*\btheme\s*:/m.test(source) ? '' : fallback

const fnv1a = (text: string, seed: number): string => {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export const cacheKey = (source: string, theme: string): string => {
  const text = `${theme}\n${source}`
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01000193)
}

// Terminal cells are roughly twice as tall as wide; one cell per 8 SVG px
// keeps reladraw's 14px text about as large as the terminal's own.
export function fitCells(
  width: number,
  height: number,
  viewportColumns: number,
): { columns: number; rows: number } {
  const clamp = (n: number) => Math.max(1, Math.min(255, Math.round(n)))
  const columns = clamp(Math.min(Math.ceil(width / 8), viewportColumns - 4))
  const rows = clamp((columns * height) / width / 2)
  return { columns, rows }
}

export const parseRenderOutput = (
  stdout: string,
): { png: string; width: number; height: number } | null => {
  const [size = '', png = ''] = stdout.trim().split('\n')
  const [width = 0, height = 0] = size.split(' ').map(Number)
  if (!png.startsWith('/') || !(width > 0) || !(height > 0)) {
    return null
  }
  return { png, width, height }
}

export const cleanError = (stderr: string): string =>
  stderr.trim().split('\n')[0]?.replace(/^\/dev\/stdin:(\d+):\s*/, 'line $1: ') || 'reladraw failed'
