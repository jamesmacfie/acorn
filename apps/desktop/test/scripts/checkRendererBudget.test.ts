import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The startup budget, checked against a fixture rather than against a real build, so the assertion is
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

// One manifest record, in the shape Vite writes: a chunk file, the chunks it imports statically, the
// modules it imports dynamically, and its stylesheets.
type Chunk = { file: string; isEntry?: boolean; imports?: string[]; dynamicImports?: string[]; css?: string[] }

// Over the check's 100 KB floor with two chunks, so a fixture only trips the floor when it means to.
const CHUNK = 60_000

describe('check-renderer-budget', () => {
  let root: string
  let dir: string

  // Writes a built client the way Vite does: each chunk and stylesheet under assets/, an index.html
  // that loads the entry and preloads its static imports, and the manifest beside the client dir.
  const build = (manifest: Record<string, Chunk>, bytes: Record<string, number> = {}) => {
    mkdirSync(join(dir, 'assets'), { recursive: true })
    for (const chunk of Object.values(manifest)) {
      for (const file of [chunk.file, ...chunk.css ?? []]) writeFileSync(join(dir, file), 'x'.repeat(bytes[file] ?? CHUNK))
    }
    const entry = Object.values(manifest).find((chunk) => chunk.isEntry)!
    const preloads = (entry.imports ?? []).map((key) => `<link rel="modulepreload" href="/${manifest[key]!.file}">`)
    const styles = (entry.css ?? []).map((file) => `<link rel="stylesheet" href="/${file}">`)
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html><html><head>\n<script type="module" src="/${entry.file}"></script>\n${[...preloads, ...styles].join('\n')}\n</head><body></body></html>`,
    )
    writeFileSync(join(root, 'renderer-manifest.json'), JSON.stringify(manifest))
  }

  // index.html loading the app directly: the entry and its static imports are the startup set.
  const direct = (imported: string, extra: Record<string, Chunk> = {}) => build({
    'index.html': { file: 'assets/index-aaaa.js', isEntry: true, imports: ['_x'], css: ['assets/index-aaaa.css'], dynamicImports: Object.keys(extra) },
    _x: { file: `assets/${imported}` },
    ...extra,
  })

  // index.html loading a small guard module that dynamic-imports the app, the shape the renderer had
  // from 2026-09-20 to 2026-09-25.
  const guarded = (imported: string) => build({
    'index.html': { file: 'assets/index-aaaa.js', isEntry: true, dynamicImports: ['src/client/index.tsx'] },
    'src/client/index.tsx': { file: 'assets/client-bbbb.js', imports: ['index.html', '_x'], css: ['assets/client-bbbb.css'] },
    _x: { file: `assets/${imported}` },
  }, { 'assets/index-aaaa.js': 1_000 })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'renderer-budget-'))
    dir = join(root, 'client')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('passes a startup list of ordinary chunks under budget, counting its stylesheets', () => {
    direct('store-bbbb.js')
    const { code, output } = run(dir)
    expect(code).toBe(0)
    expect(output).toContain(`startup scripts=${2 * CHUNK}B styles=${CHUNK}B assets=3 hops=1`)
  })

  it('counts the app behind a startup guard, not just the guard index.html names', () => {
    // The shape that blinded the check on 2026-09-24: the HTML named one small script and the check
    // reported that, while the window loaded everything the guard imports.
    guarded('store-cccc.js')
    const { code, output } = run(dir)
    expect(code).toBe(0)
    expect(output).toContain(`startup scripts=${1_000 + 2 * CHUNK}B styles=${CHUNK}B assets=4 hops=2`)
  })

  it('leaves a lazy surface out of the count and reports it as one interaction away', () => {
    direct('store-bbbb.js', { 'plugins/x/Pane.tsx': { file: 'assets/Pane-dddd.js', css: ['assets/Pane-dddd.css'] } })
    const { code, output } = run(dir)
    expect(code).toBe(0)
    expect(output).toContain(`startup scripts=${2 * CHUNK}B`)
    expect(output).toContain(`one interaction away: 2 more chunks, ${2 * CHUNK}B`)
  })

  it('fails, naming the chunk, when a denylisted name is preloaded', () => {
    direct('viewState-cccc.js')
    const { code, output } = run(dir)
    expect(code).toBe(1)
    expect(output).toContain('viewState-cccc.js')
  })

  it('fails on a denylisted name reached through the startup guard', () => {
    guarded('shiki-eeee.js')
    const { code, output } = run(dir)
    expect(code).toBe(1)
    expect(output).toContain('shiki-eeee.js')
  })

  it('fails when the whole icon set is in the startup list', () => {
    // The reason the split in kit/tokens/iconNodes.ts exists. 371 KB of geometry was a quarter of the
    // budget, and a byte total on its own let it back in whenever something else shrank.
    direct('icon-nodes-dddd.js')
    expect(run(dir).output).toContain('icon-nodes-dddd.js')
  })

  it('fails on the highlighter, which is the chunk this check was written for', () => {
    // Phase 0 allowed this one and reported it; phase 1 took it out of the startup list and deleted
    // the allowance, so it fails the build outright now (docs/performance.md).
    direct('shiki-eeee.js')
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
    build({
      'index.html': { file: 'assets/index-aaaa.js', isEntry: true, imports: ['_x'] },
      _x: { file: 'assets/store-bbbb.js' },
    }, { 'assets/index-aaaa.js': 700_000, 'assets/store-bbbb.js': 700_000 })
    const { code, output } = run(dir)
    expect(code).toBe(1)
    expect(output).toContain('Renderer startup budget exceeded')
  })

  it('fails under the floor, because a startup set that small is the wrong graph', () => {
    // A guard whose app import the check does not know about: only the guard is counted.
    build({
      'index.html': { file: 'assets/index-aaaa.js', isEntry: true, dynamicImports: ['src/client/app.tsx'] },
      'src/client/app.tsx': { file: 'assets/app-bbbb.js' },
    }, { 'assets/index-aaaa.js': 9_600 })
    const { code, output } = run(dir)
    expect(code).toBe(1)
    expect(output).toContain('under the 100000B floor')
  })

  it('fails on a manifest from another build', () => {
    direct('store-bbbb.js')
    writeFileSync(join(dir, 'index.html'), '<script type="module" src="/assets/index-zzzz.js"></script>')
    const { code, output } = run(dir)
    expect(code).toBe(1)
    expect(output).toContain('does not describe the entry')
  })
})
