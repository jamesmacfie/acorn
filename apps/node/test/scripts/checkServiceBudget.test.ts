import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The node service's size budget, checked against a fixture dist rather than a real build, so the
// assertions are about the rule and not about what the service weighs today. ./chunkGraph.test.ts
// covers the graph a real build writes.
const SCRIPT = resolve(import.meta.dirname, '../../scripts/check-service-budget.mjs')

const run = (dir: string): { code: number; output: string } => {
  try {
    return { code: 0, output: execFileSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('check-service-budget', () => {
  let dir: string
  let chunks: Record<string, { imports: string[]; dynamicImports: string[]; requires: string[]; modules: string[]; bytes: number }>
  // One minified line, as Oxc writes it: the check must not care how the imports are formatted.
  const chunk = (file: string, bytes: number, edges: { imports?: string[]; dynamicImports?: string[]; requires?: string[] } = {}) => {
    writeFileSync(join(dir, file), 'x'.repeat(bytes))
    chunks[file] = { imports: [], dynamicImports: [], requires: [], modules: [], ...edges, bytes }
  }
  const check = () => {
    writeFileSync(join(dir, 'startup-graph.json'), JSON.stringify({ entry: 'service.js', roots: ['service.js'], chunks }))
    return run(dir)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'service-budget-'))
    mkdirSync(join(dir, 'chunks'))
    chunks = {}
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('counts the static graph from service.js once and not what it imports lazily', () => {
    chunk('service.js', 1_000, { imports: ['chunks/core-1.js', 'chunks/shared-2.js', 'node:path'] })
    chunk('chunks/core-1.js', 1_200_000, {
      imports: ['chunks/shared-2.js', 'node-pty'],
      dynamicImports: ['chunks/browser-3.js', 'playwright-core'],
      requires: ['@xterm/headless'],
    })
    chunk('chunks/shared-2.js', 100_000, { imports: ['chunks/core-1.js'] })
    // Heavy, and behind a dynamic import, so it must not count.
    chunk('chunks/browser-3.js', 5_000_000)

    const result = check()
    expect(result.code).toBe(0)
    expect(result.output).toContain('and 2 chunk(s): 1301000B')
    expect(result.output).toContain('resolved at run time: node-pty; on first use: playwright-core; through createRequire: @xterm/headless')
  })

  it('counts a lazy chunk once a static import reaches it', () => {
    chunk('service.js', 1_000, { imports: ['chunks/core-1.js'] })
    chunk('chunks/core-1.js', 1_200_000, { imports: ['chunks/browser-3.js'] })
    chunk('chunks/browser-3.js', 5_000_000)

    const result = check()
    expect(result.code).not.toBe(0)
    expect(result.output).toMatch(/static graph is 6201000B, over the \d+B ceiling/)
  })

  it('fails when the walk sees too little to be the real graph', () => {
    // Everything past service.js is behind a dynamic import, so the walk stops at 13 KB. A check
    // that passed on that would be blind, and the floor turns it into a failure.
    chunk('service.js', 13_000, { dynamicImports: ['chunks/core-1.js'] })
    chunk('chunks/core-1.js', 2_000_000)

    const result = check()
    expect(result.code).not.toBe(0)
    expect(result.output).toMatch(/under the \d+B floor/)
  })

  it('refuses a graph that does not describe the files beside it', () => {
    chunk('service.js', 1_000, { imports: ['chunks/core-1.js'] })
    chunk('chunks/core-1.js', 1_200_000)
    chunks['chunks/core-1.js'].bytes = 1_100_000

    const result = check()
    expect(result.code).not.toBe(0)
    expect(result.output).toContain('records 1100000 B for chunks/core-1.js, which has 1200000 B')
  })
})
