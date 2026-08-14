import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Can the Electron-free node LOAD every plugin's main barrel?
//
// main/ is a plugin's Electron adapter, and apps/node is the composition root that has no Electron.
// It still imports from those barrels (`reconcileTmux` from terminal's), and a barrel evaluates every
// module on it — so one static value import of `dialog` out of the electron package, anywhere behind
// one of them, makes the standalone node die at boot with "The requested module 'electron' does not
// provide an export named 'dialog'". That is not hypothetical: it is the root cause of the two
// environmentally-failing integration tests in docs/testing.md, and the fix was a lazy `createRequire`
// in the file that got caught. What replaced the rule afterwards was a file allowlist in
// tools/arch/boundaries.test.ts, which checks WHICH files name electron rather than whether this node
// can boot. This is the check that asks the actual question.
//
// The glob is the point. It covers the next plugin's main barrel the day it appears, which an
// allowlist by construction cannot.
//
// main/ only. The node/ and server/ halves are already loaded by every composition-root suite in this
// directory, because assembleNodeGraph imports them; main/ is the half nothing here would touch.
const APP_ROOT = resolve(import.meta.dirname, '../..')
const ROOT = resolve(APP_ROOT, '../..')
const barrels = readdirSync(join(ROOT, 'plugins'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(ROOT, 'plugins', entry.name, 'src/main/index.ts'))
  .filter(existsSync)

// A CHILD `node --import tsx`, not an in-process `await import()`, and this is the one place where
// running it inside vitest would be dishonest. Vite's CommonJS interop resolves a named value import
// of `ipcMain` out of the electron package to undefined and carries on, so the in-process import of
// preview's barrel passed while plain Node failed on the same file — the leniency is in the transform,
// and the runtime that has to boot does not have it. Node's ESM linker checks the named exports of
// electron's CJS shim before a line of the module runs, which is the failure being prevented.
//
// (This file describes those imports in prose rather than writing them out, because
// tools/arch/boundaries.test.ts scans import forms without stripping comments and says so.)
//
// One child for all barrels rather than one each: a per-import try/catch still attributes each
// failure, and this is a test that spends a second on a process, not thirty on five.
const script = `
import { writeSync } from 'node:fs'
const failures = []
for (const file of JSON.parse(process.env.ACORN_MAIN_BARRELS)) {
  try {
    await import(file)
  } catch (error) {
    failures.push(file + ': ' + (error instanceof Error ? error.message : String(error)))
  }
}
writeSync(1, JSON.stringify(failures))
// Explicit: a barrel may leave a handle open (a PTY engine, an interval), and the exit code is not
// what this test reads.
process.exit(0)
`

describe('plugin main barrels load outside Electron', () => {
  it('imports every plugins/*/src/main/index.ts in plain Node', () => {
    // Anti-vacuity: an empty glob would satisfy the assertion below trivially, and terminal's barrel
    // is the one whose electron import broke boot — it must always be in the set.
    expect(barrels.length).toBeGreaterThanOrEqual(3)
    expect(barrels.map((file) => relative(ROOT, file))).toContain('plugins/terminal/src/main/index.ts')

    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      // apps/node, because that is where `tsx` is declared — and because it is the composition root
      // whose bootability this is about (`dev:node` runs the same `node --import tsx`).
      cwd: APP_ROOT,
      env: { ...process.env, ACORN_MAIN_BARRELS: JSON.stringify(barrels) },
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(child.error).toBeUndefined()
    // The child prints a JSON array and nothing else; anything unparseable means it never got that
    // far, and the stderr is the interesting part.
    const failures = ((): string[] => {
      try {
        return JSON.parse(child.stdout.trim()) as string[]
      } catch {
        throw new Error(`loader child produced no result\nstdout: ${child.stdout}\nstderr: ${child.stderr}`)
      }
    })()
    expect(failures.map((line) => line.replace(`${ROOT}/`, ''))).toEqual([])
  })
})
