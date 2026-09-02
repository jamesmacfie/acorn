import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The eager-graph walk, checked against a fixture dist whose closure is known by construction, so the
// assertion is about the walk and not about whatever the bundle weighs today
// (../scripts/check-startup-graph.mjs, docs/frontend.md § Startup budget).
const SCRIPT = resolve(import.meta.dirname, '../scripts/check-startup-graph.mjs')

const run = (dist: string): { code: number; output: string } => {
  try {
    return { code: 0, output: execFileSync('node', [SCRIPT, '--dist', dist], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('check-startup-graph', () => {
  let dist: string
  const chunk = (name: string, body: string) => writeFileSync(join(dist, 'chunks', name), body)

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'tui-startup-'))
    mkdirSync(join(dist, 'chunks'))
  })
  afterEach(() => rmSync(dist, { recursive: true, force: true }))

  it('sums the static closure and leaves what only a dynamic import reaches out of it', () => {
    // 4 chunks on disk, 3 in the closure: `App` reaches `rail` and `kit`, and `heavy` only behind an
    // `import()`. Sizes are padded so the total is unmistakable.
    chunk('App-aaaa.js', `import "./rail-bbbb.js";\nconst open = () => import("./heavy-dddd.js");\n${'/'.repeat(100)}`)
    chunk('rail-bbbb.js', `import { k } from "./kit-cccc.js";\n${'/'.repeat(100)}`)
    chunk('kit-cccc.js', `export const k = 1;\n${'/'.repeat(100)}`)
    chunk('heavy-dddd.js', 'x'.repeat(500_000))

    const { code, output } = run(dist)
    expect(code).toBe(0)
    expect(output).toContain('3 chunks')
    expect(output).toMatch(/eager closure from App-aaaa\.js: 3 chunks, \d+B of \d+B built/)
    expect(output).not.toContain('heavy-dddd.js')
  })

  it('fails, naming the chunk, when a denylisted name is reached statically', () => {
    chunk('App-aaaa.js', 'import "./viewState-bbbb.js";\n')
    chunk('viewState-bbbb.js', 'export const v = 1;\n')
    const { code, output } = run(dist)
    expect(code).toBe(1)
    expect(output).toContain('viewState-bbbb.js')
  })

  it('reports a chunk phase 1 still owes without failing the build', () => {
    chunk('App-aaaa.js', 'import "./prModel-bbbb.js";\n')
    chunk('prModel-bbbb.js', 'export const p = 1;\n')
    const { code, output } = run(dist)
    expect(code).toBe(0)
    expect(output).toContain('KNOWN FAILURE: prModel-bbbb.js')
  })

  it('fails when a known failure is fixed, so the allowance cannot outlive it', () => {
    chunk('App-aaaa.js', 'const open = () => import("./prModel-bbbb.js");\n')
    chunk('prModel-bbbb.js', 'export const p = 1;\n')
    const { code, output } = run(dist)
    expect(code).toBe(1)
    expect(output).toContain('Out of the eager graph now: prModel')
  })

  it('fails over the byte ceiling', () => {
    chunk('App-aaaa.js', `import "./big-bbbb.js";\n`)
    chunk('big-bbbb.js', 'x'.repeat(1_200_000))
    const { code, output } = run(dist)
    expect(code).toBe(1)
    expect(output).toContain('over its 1150000B ceiling')
  })

  it('refuses to guess when there is no single App chunk to walk from', () => {
    chunk('main-aaaa.js', 'export const m = 1;\n')
    expect(run(dist).output).toContain('expected exactly one')
  })
})
