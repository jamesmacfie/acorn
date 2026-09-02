import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('fails on the highlighter, which is the chunk this check was written for', () => {
    // Phase 0 allowed this one and reported it; phase 1 took it out of the startup list and deleted
    // the allowance, so it fails the build outright now (docs/future/performance/measurements.md).
    client(['index-aaaa.js', 'shiki-eeee.js'])
    const { code, output } = run(dir)
    expect(code).toBe(1)
    expect(output).toContain('shiki-eeee.js')
  })

  it('excuses nothing', () => {
    // The allowance list is the one thing in the script that can turn a red build green, so it is
    // asserted rather than trusted. It held `shiki`, `DiffPane` and `prModel` while phase 1 was owed
    // and has been empty since. Adding a name back is a deliberate act and this is where it argues
    // for itself.
    expect(readFileSync(SCRIPT, 'utf8')).toContain('const KNOWN = []')
  })

  it('fails over the byte budget', () => {
    client(['index-aaaa.js', 'store-bbbb.js', 'shiki-eeee.js', 'DiffPane-ffff.js', 'prModel-gggg.js'], 300_000)
    const { code, output } = run(dir)
    expect(code).toBe(1)
    expect(output).toContain('Renderer startup budget exceeded')
  })
})
