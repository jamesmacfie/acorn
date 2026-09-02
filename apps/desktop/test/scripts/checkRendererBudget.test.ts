import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The startup denylist, checked against a fixture rather than against a real build, so the assertion is
// about the rule and not about whatever the renderer happens to weigh today
// (docs/frontend.md § Startup budget).
const SCRIPT = resolve(import.meta.dirname, '../../scripts/check-renderer-budget.mjs')

const run = (dir: string): { code: number; output: string } => {
  try {
    return { code: 0, output: execFileSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('check-renderer-budget', () => {
  let dir: string

  const client = (chunks: string[], bytesEach = 100) => {
    mkdirSync(join(dir, 'assets'), { recursive: true })
    for (const chunk of chunks) writeFileSync(join(dir, 'assets', chunk), 'x'.repeat(bytesEach))
    const preloads = chunks.slice(1).map((chunk) => `<link rel="modulepreload" href="/assets/${chunk}">`).join('\n')
    writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head>\n<script type="module" src="/assets/${chunks[0]}"></script>\n${preloads}\n</head><body></body></html>`)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'renderer-budget-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('passes a startup list of ordinary chunks under budget', () => {
    client(['index-aaaa.js', 'store-bbbb.js'])
    const { code, output } = run(dir)
    expect(code).toBe(0)
    expect(output).toContain('startup scripts=200B')
  })

  it('fails, naming the chunk, when a denylisted name is preloaded', () => {
    client(['index-aaaa.js', 'viewState-cccc.js'])
    const { code, output } = run(dir)
    expect(code).toBe(1)
    expect(output).toContain('viewState-cccc.js')
  })

  it('fails when the whole icon set is in the startup list', () => {
    // The reason the split in kit/tokens/iconNodes.ts exists. 371 KB of geometry was a quarter of the
    // budget, and a byte total on its own let it back in whenever something else shrank.
    client(['index-aaaa.js', 'icon-nodes-dddd.js'])
    expect(run(dir).output).toContain('icon-nodes-dddd.js')
  })

  it('reports a chunk phase 1 still owes without failing the build', () => {
    client(['index-aaaa.js', 'shiki-eeee.js'])
    const { code, output } = run(dir)
    expect(code).toBe(0)
    expect(output).toContain('KNOWN FAILURE: shiki-eeee.js')
  })

  it('fails when a known failure is fixed, so the allowance cannot outlive it', () => {
    // Built, but no longer fetched at startup: exactly what phase 1 will produce, and the build says
    // so rather than letting the allowance sit there ready to excuse a regression.
    client(['index-aaaa.js'])
    writeFileSync(join(dir, 'assets', 'shiki-eeee.js'), 'x')
    const { code, output } = run(dir)
    expect(code).toBe(1)
    expect(output).toContain('No longer fetched at startup')
    expect(output).toContain('Delete')
  })

  it('fails over the byte budget', () => {
    client(['index-aaaa.js', 'store-bbbb.js', 'shiki-eeee.js', 'DiffPane-ffff.js', 'prModel-gggg.js'], 300_000)
    const { code, output } = run(dir)
    expect(code).toBe(1)
    expect(output).toContain('Renderer startup budget exceeded')
  })
})
