import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, '../scripts/check-runtime-imports.mjs')

const run = (dist: string): { code: number; output: string } => {
  try {
    return { code: 0, output: execFileSync('node', [SCRIPT, '--dist', dist], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('check-runtime-imports', () => {
  let dist: string

  beforeEach(() => { dist = mkdtempSync(join(tmpdir(), 'tui-runtime-imports-')) })
  afterEach(() => rmSync(dist, { recursive: true, force: true }))

  it('accepts installed packages and Node builtins', () => {
    writeFileSync(join(dist, 'main.js'), 'import { z } from "zod";\nimport "node:fs";\n')
    expect(run(dist)).toMatchObject({ code: 0 })
  })

  it('reports a missing import in a lazy chunk', () => {
    writeFileSync(join(dist, 'lazy.js'), 'const load = () => import("acorn-package-that-does-not-exist");\n')
    const { code, output } = run(dist)
    expect(code).toBe(1)
    expect(output).toContain('acorn-package-that-does-not-exist (imported by lazy.js)')
  })
})
