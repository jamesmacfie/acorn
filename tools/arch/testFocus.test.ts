import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const runner = fileURLToPath(new URL('../../scripts/test-focus.mjs', import.meta.url))

function focus(...args: string[]) {
  return spawnSync(process.execPath, [runner, ...args], { cwd: root, encoding: 'utf8' })
}

describe('focused test command', () => {
  it('preserves arguments when pnpm is a JavaScript CLI', () => {
    const invocation = spawnSync(process.execPath, ['--input-type=module', '-e',
      "import { pnpmInvocation } from './scripts/run-pnpm.mjs'; console.log(JSON.stringify(pnpmInvocation(['--filter', '@acorn/protocol', '-t', 'two words'])))",
    ], { cwd: root, encoding: 'utf8', env: { ...process.env, npm_execpath: 'C:\\pnpm\\pnpm.cjs' } })
    expect(invocation.status, invocation.stderr).toBe(0)
    expect(JSON.parse(invocation.stdout)).toEqual([
      process.execPath,
      ['C:\\pnpm\\pnpm.cjs', '--filter', '@acorn/protocol', '-t', 'two words'],
    ])
  })

  it('runs one named test and rejects an empty named selection', () => {
    const file = 'src/device/fingerprintWords.test.ts'
    const selected = focus('@acorn/protocol', file, '-t', 'is exactly 256 entries')
    expect(selected.status, selected.stderr).toBe(0)
    expect(selected.stdout).toContain('1 passed')

    const empty = focus('@acorn/protocol', file, '-t', 'no test has this name')
    expect(empty.status).toBe(1)
    expect(empty.stdout + empty.stderr).toContain('matched no runnable tests')
  }, 30_000)

  it('rejects selectors that match multiple packages before preparation', () => {
    const selected = focus('@acorn/*', 'src/device/fingerprintWords.test.ts')
    expect(selected.status).toBe(2)
    expect(selected.stderr).toContain('Expected one exact workspace package')
    expect(selected.stdout).not.toContain('rebuild:node')
  }, 15_000)
})
