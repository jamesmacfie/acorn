import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The node service's size budget, checked against a fixture dist rather than a real build, so the
// assertions are about the rule and not about what the service weighs today.
const SCRIPT = resolve(import.meta.dirname, '../../scripts/check-service-budget.mjs')

const run = (dir: string): { code: number; output: string } => {
  try {
    return { code: 0, output: execFileSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

// A chunk of `bytes` bytes that starts with the given import lines, the way Rolldown writes them.
const chunk = (imports: string[], bytes: number): string => {
  const head = `${imports.join('\n')}\n`
  return head + '/'.repeat(Math.max(0, bytes - head.length))
}

describe('check-service-budget', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'service-budget-'))
    mkdirSync(join(dir, 'chunks'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('counts the static graph from service.js and not what it imports lazily', () => {
    writeFileSync(join(dir, 'service.js'), chunk(['import { a } from "./chunks/core-1.js";', 'import { z } from "node:path";'], 1_000))
    writeFileSync(join(dir, 'chunks/core-1.js'), chunk([
      'import "./shared-2.js";',
      'import { spawn } from "node-pty";',
      'const lazy = () => import("./browser-3.js");',
      'const driver = () => import("playwright-core");',
    ], 1_200_000))
    writeFileSync(join(dir, 'chunks/shared-2.js'), chunk(['export { b } from "./core-1.js";'], 100_000))
    // Heavy, and behind a dynamic import, so it must not count.
    writeFileSync(join(dir, 'chunks/browser-3.js'), chunk([], 5_000_000))

    const result = run(dir)
    expect(result.code).toBe(0)
    expect(result.output).toContain('and 2 chunk(s): 1301000B')
    expect(result.output).toContain('resolved at run time: node-pty; on first use: playwright-core')
  })

  it('fails over the ceiling', () => {
    writeFileSync(join(dir, 'service.js'), chunk(['import { a } from "./chunks/core-1.js";'], 1_000))
    writeFileSync(join(dir, 'chunks/core-1.js'), chunk([], 4_000_000))

    const result = run(dir)
    expect(result.code).not.toBe(0)
    expect(result.output).toMatch(/over the \d+B ceiling/)
  })

  it('fails when the walk sees too little to be the real graph', () => {
    // Everything past service.js is behind a dynamic import, so the walk stops at 13 KB. A check
    // that passed on that would be blind, and the floor turns it into a failure.
    writeFileSync(join(dir, 'service.js'), chunk(['const x = 1; import("./chunks/core-1.js");'], 13_000))
    writeFileSync(join(dir, 'chunks/core-1.js'), chunk([], 2_000_000))

    const result = run(dir)
    expect(result.code).not.toBe(0)
    expect(result.output).toMatch(/under the \d+B floor/)
  })
})
