import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, '../scripts/check-startup-graph.mjs')
const run = (dist: string): { code: number; output: string } => {
  try {
    return { code: 0, output: execFileSync('node', [SCRIPT, '--dist', dist], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('complete terminal startup budget', () => {
  let dist: string
  let chunks: Record<string, { imports: string[]; dynamicImports: string[]; modules: string[] }>
  let roots: string[]
  const chunk = (file: string, bytes = 100, imports: string[] = [], modules: string[] = [], dynamicImports: string[] = []) => {
    writeFileSync(join(dist, file), 'x'.repeat(bytes))
    chunks[file] = { imports, modules, dynamicImports }
  }
  const check = () => {
    writeFileSync(join(dist, 'startup-graph.json'), JSON.stringify({ entry: 'main.js', roots, chunks }))
    return run(dist)
  }
  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'tui-startup-'))
    mkdirSync(join(dist, 'chunks'))
    chunks = {}
    roots = ['main.js', 'chunks/App-a.js']
    chunk('main.js')
    chunk('chunks/App-a.js')
  })
  afterEach(() => rmSync(dist, { recursive: true, force: true }))

  it('counts the launcher, awaited dynamic roots and shared static chunks exactly once', () => {
    chunk('main.js', 100, ['chunks/shared.js'], [], ['chunks/App-a.js', 'chunks/cache.js', 'chunks/roster.js'])
    chunk('chunks/App-a.js', 100, ['chunks/shared.js'])
    chunk('chunks/cache.js', 200, ['chunks/shared.js'])
    chunk('chunks/shared.js', 300)
    chunk('chunks/roster.js', 900_000)
    roots.push('chunks/cache.js')
    const { code, output } = check()
    expect(code).toBe(0)
    expect(output).toContain('4 chunks, 700B of 900700B built')
  })

  it('keeps a static edge even when the same chunk also has a dynamic edge', () => {
    chunk('main.js', 100, ['chunks/big.js'], [], ['chunks/big.js'])
    chunk('chunks/big.js', 800_000)
    expect(check().output).toContain('over its 720000B ceiling')
  })

  it('counts launcher-only bytes that an App-only walk would miss', () => {
    chunk('main.js', 800_000)
    expect(check().code).toBe(1)
  })

  it.each(['viewState', 'prModel', 'RemoteTree', 'TreeHost', 'roster'])('rejects %s merged into an unrelated startup chunk', (name) => {
    chunk('chunks/App-a.js', 100, [], [`apps/tui/src/plugins/${name}.tsx`])
    const result = check()
    expect(result.code).toBe(1)
    expect(result.output).toContain(`${name}.tsx (in chunks/App-a.js)`)
  })

  it('rejects an external ORM import and reports other external packages without claiming their bytes', () => {
    chunk('main.js', 100, ['ws', 'drizzle-orm/sqlite-core'])
    const result = check()
    expect(result.code).toBe(1)
    expect(result.output).toContain('external runtime imports (bytes not counted): drizzle-orm/sqlite-core, ws')
    expect(result.output).toContain('Denylisted startup dependencies: drizzle-orm/sqlite-core')
  })

  it('refuses a manifest that omits the launcher or names a missing chunk', () => {
    roots = ['chunks/App-a.js']
    expect(check().output).toContain('must include main.js')
    roots.push('main.js', 'chunks/missing.js')
    expect(check().output).toContain('missing startup chunk chunks/missing.js')
  })
})
