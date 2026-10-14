import { describe, expect, test } from 'claude-code/testing'

import {
  cacheKey,
  cleanError,
  fitCells,
  parseRenderOutput,
  splitSegments,
  themeFor,
} from '../hooks/parse'

const FENCE = '```'

describe('splitSegments', () => {
  test('splits markdown around a closed reladraw fence', () => {
    const text = `Before\n\n${FENCE}reladraw\nnode a "A"\n${FENCE}\n\nAfter`
    expect(splitSegments(text)).toEqual([
      { kind: 'markdown', text: 'Before\n' },
      { kind: 'diagram', source: 'node a "A"', raw: `${FENCE}reladraw\nnode a "A"\n${FENCE}` },
      { kind: 'markdown', text: '\nAfter' },
    ])
  })

  test('leaves a fence still open (mid-stream) as markdown', () => {
    const text = `Hi\n${FENCE}reladraw\nnode a "A"`
    expect(splitSegments(text)).toEqual([{ kind: 'markdown', text }])
  })

  test('needs a closing fence at least as long as the opening one', () => {
    const text = `${FENCE}\`reladraw\nnode a "A"\n${FENCE}\nnode b "B"\n${FENCE}\``
    const [segment] = splitSegments(text)
    expect(segment).toEqual({
      kind: 'diagram',
      source: `node a "A"\n${FENCE}\nnode b "B"`,
      raw: text,
    })
  })

  test('ignores other languages and empty diagrams', () => {
    const text = `${FENCE}mermaid\ngraph TD\n${FENCE}\n${FENCE}reladraw\n\n${FENCE}`
    expect(splitSegments(text)).toEqual([{ kind: 'markdown', text }])
  })
})

describe('helpers', () => {
  test('themeFor keeps a theme the source names', () => {
    expect(themeFor('node a "A"', 'dark')).toBe('dark')
    expect(themeFor('diagram theme: nord\nnode a "A"', 'dark')).toBe('')
  })

  test('cacheKey differs by theme and source', () => {
    expect(cacheKey('a', 'dark')).toMatch(/^[0-9a-f]{16}$/)
    expect(cacheKey('a', 'dark')).not.toBe(cacheKey('a', 'light'))
    expect(cacheKey('a', 'dark')).not.toBe(cacheKey('b', 'dark'))
  })

  test('fitCells keeps the aspect ratio and the viewport', () => {
    expect(fitCells(311, 127, 120)).toEqual({ columns: 39, rows: 8 })
    expect(fitCells(4000, 1000, 80)).toEqual({ columns: 76, rows: 10 })
    expect(fitCells(100, 9000, 80).rows).toBe(255)
  })

  test('parseRenderOutput reads size and path', () => {
    expect(parseRenderOutput('311 127\n/c/x.png\n')).toEqual({ png: '/c/x.png', width: 311, height: 127 })
    expect(parseRenderOutput('\n/c/x.png\n')).toBeNull()
  })

  test('cleanError points at the diagram line', () => {
    expect(cleanError('/dev/stdin:3: node "a": "x" is not a direction\n')).toBe(
      'line 3: node "a": "x" is not a direction',
    )
    expect(cleanError('')).toBe('reladraw failed')
  })
})
