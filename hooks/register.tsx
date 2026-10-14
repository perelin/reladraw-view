import type { Register } from 'claude-code'

import {
  cacheKey,
  cleanError,
  fitCells,
  hasDiagramFence,
  parseRenderOutput,
  splitSegments,
  themeFor,
} from './parse'
import { RENDER_SCRIPT } from './script'

const DEFAULT_THEME = 'light'
// The engine draws a reply two columns in, after its bullet.
const REPLY_INDENT = 2
const QUEUE_POLL_MS = 250

type Rendered =
  | { isOk: true; png: string; width: number; height: number }
  | { isOk: false; error: string }

type Job = { key: string; source: string; theme: string }

export const register: Register = on => {
  const results = new Map<string, Rendered>()
  const queue = new Map<string, Job>()

  // A render hook's `$` calls end with its dispatch, which every redraw
  // abandons, so renders run on a timer started here and the render hook only
  // queues them.
  on('session.start', async ($, e, next) => {
    let isDraining = false
    $.clock.every(QUEUE_POLL_MS, async () => {
      if (isDraining || queue.size === 0) {
        return
      }
      isDraining = true
      try {
        for (const job of queue.values()) {
          let rendered: Rendered
          try {
            const result = await $.process.run(
              ['/bin/sh', '-c', RENDER_SCRIPT, 'reladraw-view', job.key, job.theme],
              { stdin: job.source, timeoutMs: 15_000 },
            )
            const output = result.exitCode === 0 ? parseRenderOutput(result.stdout) : null
            rendered = output
              ? { isOk: true, ...output }
              : { isOk: false, error: cleanError(result.stderr) }
          } catch (error) {
            rendered = { isOk: false, error: String(error) }
          }
          results.set(job.key, rendered)
          queue.delete(job.key)
          $.ui.invalidate('ui.render')
        }
      } finally {
        isDraining = false
      }
    })
    return next(e)
  })

  on(
    'ui.render',
    { component: 'AssistantMessage', surface: 'terminal' },
    async ($, e, next) => {
      if (e.component !== 'AssistantMessage' || !hasDiagramFence(e.props.text)) {
        return next(e)
      }

      const segments = splitSegments(e.props.text)
      const diagrams = segments.flatMap(s => {
        if (s.kind !== 'diagram') {
          return []
        }
        const theme = themeFor(s.source, DEFAULT_THEME)
        return [{ segment: s, job: { key: cacheKey(s.source, theme), source: s.source, theme } }]
      })
      if (diagrams.length === 0) {
        return next(e)
      }

      const missing = diagrams.filter(d => !results.has(d.job.key))
      if (missing.length > 0) {
        for (const { job } of missing) {
          queue.set(job.key, job)
        }
        return next(e)
      }

      const { Box, Image, Text } = $.ui.resolve(e)
      const viewportColumns = (e.viewport?.columns ?? 80) - REPLY_INDENT
      const drawn = await Promise.all(
        segments.map(async (segment, i) => {
          const result = segment.kind === 'diagram'
            ? results.get(cacheKey(segment.source, themeFor(segment.source, DEFAULT_THEME)))
            : undefined
          if (segment.kind === 'markdown' || !result?.isOk) {
            const text = segment.kind === 'markdown' ? segment.text : segment.raw
            const engine = await next({
              ...e,
              props: { ...e.props, text, isFirstOfReply: e.props.isFirstOfReply && i === 0 },
            })
            if (segment.kind === 'markdown' || !result || result.isOk) {
              return engine
            }
            return (
              <Box key={`err-${i}`} flexDirection="column">
                {engine}
                <Box marginLeft={REPLY_INDENT}>
                  <Text dimColor>reladraw: {result.error}</Text>
                </Box>
              </Box>
            )
          }
          const { columns, rows } = fitCells(result.width, result.height, viewportColumns)
          return (
            <Box key={`img-${i}`} marginLeft={REPLY_INDENT} marginTop={1}>
              <Image
                source={{ file: result.png, format: 'png' }}
                columns={columns}
                rows={rows}
                alt={`reladraw diagram (${segment.source.split('\n').length} lines)`}
              />
            </Box>
          )
        }),
      )

      return <Box flexDirection="column">{drawn}</Box>
    },
  )
}
