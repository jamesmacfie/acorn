import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The census is what keeps the eager set from rotting: an icon spelled in the tree and missing from
// iconNodes.eager.json would render as its own text for a frame, and this is the check that says so
// before it ships (../../../scripts/icon-census.mjs).
const SCRIPT = resolve(import.meta.dirname, '../../../scripts/icon-census.mjs')
const LUCIDE = resolve(import.meta.dirname, '../../../node_modules/lucide-static/icon-nodes.json')

const run = (args: string[]): { code: number; output: string } => {
  try {
    return { code: 0, output: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('icon census', () => {
  let dir: string
  const eager = () => join(dir, 'eager.json')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icon-census-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('fails, naming the icon, when a literal in the tree is not in the eager set', () => {
    writeFileSync(join(dir, 'Pane.tsx'), 'export const P = () => <Icon name="chef-hat" />\n')
    writeFileSync(eager(), '{}')
    const { code, output } = run(['--check', '--root', dir, '--eager', eager(), '--lucide', LUCIDE])
    expect(code).toBe(1)
    expect(output).toContain('chef-hat')
  })

  it('passes once the set is regenerated, and the regeneration carries the geometry', () => {
    writeFileSync(join(dir, 'Pane.tsx'), "export const glyph = { icon: 'chef-hat' }\n")
    run(['--root', dir, '--eager', eager(), '--lucide', LUCIDE])
    const written = JSON.parse(readFileSync(eager(), 'utf8')) as Record<string, unknown[]>
    expect(Object.keys(written)).toEqual(['chef-hat'])
    expect(written['chef-hat'].length).toBeGreaterThan(0)
    expect(run(['--check', '--root', dir, '--eager', eager(), '--lucide', LUCIDE]).code).toBe(0)
  })

  it('ignores a literal that is not a Lucide name, so an inline glyph stays lazy-free', () => {
    // The fallback those rely on is deliberate (docs/ui-design.md § Icons). A census that treated
    // every string as an icon name would put half the tree's vocabulary in the startup chunk.
    writeFileSync(join(dir, 'Pane.tsx'), "export const glyph = { icon: 'brand-that-lucide-lacks' }\n")
    run(['--root', dir, '--eager', eager(), '--lucide', LUCIDE])
    expect(JSON.parse(readFileSync(eager(), 'utf8'))).toEqual({})
  })

  it('holds for the real tree', () => {
    expect(run(['--check']).code).toBe(0)
  })
})
