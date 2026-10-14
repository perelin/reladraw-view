import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const FENCE = '```'
const DIAGRAM = `Here:\n\n${FENCE}reladraw\nnode a "A"\nnode b "B" right of a\n${FENCE}\n\nDone.`

const result = (stdout: string, stderr: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

const startSession = async ($: Engine, on: On) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

const reply = (text: string) => ({
  plugin: 'reladraw-view',
  surface: 'terminal' as const,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns: 100, rows: 40 },
})


test('a closed fence shows the engine drawing first, then the Image once rendered', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[] = []
  on('process.run', ($, e) => {
    runs.push(e.init?.stdin ?? '')
    return result('311 127\n/cache/abc.png\n', '')
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.component === 'AssistantMessage' ? e.props.text : ''}</Text>
  })

  await startSession($, on)
  const ui = await $.ui.mount(reply(DIAGRAM))
  expect(await ui.find({ type: 'Image' })).toBeUndefined()

  await clock.advance(300)
  await ui.redraw()

  const image = await ui.find({ type: 'Image' })
  expect(image?.props).toMatchObject({
    source: { file: '/cache/abc.png', format: 'png' },
    columns: 39,
    rows: 8,
  })
  expect(await ui.find({ type: 'Text', text: /Here:/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Done\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /node a/ })).toBeUndefined()

  await ui.redraw()
  expect(runs).toEqual(['node a "A"\nnode b "B" right of a'])
  await ui.unmount()
})

test('a reladraw error keeps the engine-drawn source and says why', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', () => result('', '/dev/stdin:2: node "b": "rigth" is not a direction\n', 1))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.component === 'AssistantMessage' ? e.props.text : ''}</Text>
  })

  await startSession($, on)
  const ui = await $.ui.mount(reply(DIAGRAM))
  await clock.advance(300)
  await ui.redraw()

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /node a "A"/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /line 2: node "b"/ })).toBeDefined()
  await ui.unmount()
})

test('a fence still streaming is left to the engine', async ($, on) => {
  const clock = mock.clock(on)
  let runs = 0
  on('process.run', () => {
    runs += 1
    return result('', '')
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await startSession($, on)
  const ui = await $.ui.mount(reply(`Drawing:\n${FENCE}reladraw\nnode a "A"`))
  await clock.advance(300)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(runs).toBe(0)
  await ui.unmount()
})
