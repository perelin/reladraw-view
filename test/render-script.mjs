// Runs hooks/script.ts's RENDER_SCRIPT for real, with fake reladraw and
// rsvg-convert binaries for both CLI forms. Kept out of `claude plugin test`,
// whose sandbox allows no child processes: run it with `node --test test/render-script.mjs`.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../hooks/script.ts'), 'utf8')
const literal = source.slice(source.indexOf('RENDER_SCRIPT = `') + 'RENDER_SCRIPT = '.length, source.lastIndexOf('`') + 1)
const RENDER_SCRIPT = new Function(`return ${literal}`)()

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="311" height="127"></svg>'

const NEW_CLI = `#!/bin/sh
case "$1" in
  --version) echo "0.21.0"; exit 0 ;;
  --help) echo "  reladraw render <input.reladraw> [-o <output.svg>]"; exit 0 ;;
  render) ;;
  *) echo "reladraw: a command comes first" >&2; exit 1 ;;
esac
echo "$@" >> "$LOG"
cat > /dev/null
while [ "$1" != "-o" ]; do shift; done
printf '%s' '${SVG}' > "$2"
echo "$2"
`

const OLD_CLI = `#!/bin/sh
case "$1" in
  --version) echo "0.16.0"; exit 0 ;;
  --help) echo "  reladraw <input.reladraw> [-o <output.svg>]"; exit 0 ;;
  render) echo "reladraw: cannot read render" >&2; exit 1 ;;
esac
echo "$@" >> "$LOG"
cat > /dev/null
while [ "$1" != "-o" ]; do shift; done
printf '%s' '${SVG}' > "$2"
`

// rsvg-convert -z 2 -o <png> <svg>
const RSVG = `#!/bin/sh
cp "$5" "$4"
`

function setup(cli) {
  const root = mkdtempSync(join(tmpdir(), 'reladraw-view-'))
  const install = (name, body) => {
    writeFileSync(join(root, name), body)
    chmodSync(join(root, name), 0o755)
  }
  install('reladraw', cli)
  install('rsvg-convert', RSVG)
  const log = join(root, 'calls.log')
  const run = (key, theme) =>
    spawnSync('/bin/sh', ['-c', RENDER_SCRIPT, 'reladraw-view', key, theme], {
      input: 'node a "A"\n',
      encoding: 'utf8',
      env: { PATH: `${root}:/usr/bin:/bin`, HOME: root, XDG_CACHE_HOME: join(root, 'cache'), LOG: log },
    })
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [])
  return { install, run, calls, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('uses `reladraw render` when the CLI has it', t => {
  const { run, calls, cleanup } = setup(NEW_CLI)
  t.after(cleanup)
  const result = run('k1', 'light')
  assert.equal(result.status, 0, result.stderr)
  const [size, png] = result.stdout.trim().split('\n')
  assert.equal(size, '311 127')
  assert.match(png, /\/k1-0\.21\.0\.png$/)
  assert.ok(existsSync(png))
  assert.match(calls()[0], /^render \S+\/k1-0\.21\.0\.reladraw -o \S+ --theme light$/)
})

test('falls back to the old form for a CLI without `render`', t => {
  const { run, calls, cleanup } = setup(OLD_CLI)
  t.after(cleanup)
  const result = run('k2', '')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout.trim().split('\n')[1], /\/k2-0\.16\.0\.png$/)
  assert.match(calls()[0], /^\S+\/k2-0\.16\.0\.reladraw -o \S+$/)
})

test('reuses the cached picture until the reladraw version changes', t => {
  const { install, run, calls, cleanup } = setup(NEW_CLI)
  t.after(cleanup)
  run('k3', 'light')
  run('k3', 'light')
  assert.equal(calls().length, 1)
  install('reladraw', NEW_CLI.replace('0.21.0', '0.22.0'))
  assert.match(run('k3', 'light').stdout, /k3-0\.22\.0\.png/)
  assert.equal(calls().length, 2)
})

test('stdout holds only size and path, whatever reladraw prints', t => {
  const { run, cleanup } = setup(NEW_CLI)
  t.after(cleanup)
  assert.equal(run('k4', 'light').stdout.trim().split('\n').length, 2)
})

test('a failing reladraw fails the script and leaves no picture', t => {
  const { install, run, cleanup } = setup(NEW_CLI)
  t.after(cleanup)
  install('reladraw', NEW_CLI.replace('render) ;;', 'render) echo "$2:1: bad" >&2; exit 1 ;;'))
  const result = run('k5', 'light')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /k5-0\.21\.0\.reladraw:1: bad/)
  assert.equal(result.stdout, '')
})
