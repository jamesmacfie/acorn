import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_API_MAJOR } from './pluginManifest'
import { installedPluginInfo, loadExternalPlugins, pluginInstallDir } from './pluginLoader'

// One plugin package on disk declaring all five extension kinds, and filling one of somebody else's
// point in each of them (docs/plugins.md § Cooperative extension points).
//
// Every kind has tests of its own — the manifest parser's, the hook runner's, the arbitration rule's,
// the two slot hosts'. What none of them answers is whether the five fit together in one manifest:
// the parser reads one `extensionPoints` array with five shapes in it, and each shape needs different
// fields to be present and different ones to be absent. Phase 4 of the layout programme called this
// its "done when" and never wrote it.
//
// From disk, through the real loader, because that is the path a stranger's package takes. A manifest
// object handed straight to the parser would skip the part where the bytes are read, the id is bound
// from the directory, and the routes are confined to the plugin's own namespace.

let root = ''

const ID = 'kitchen-sink'

/** All five kinds the owner opens, and all five it fills in somebody else's plugin. */
const contributions = {
  frames: [
    // The owner's own pane, which two of its points hang off.
    { target: 'pane', id: 'sink', label: 'Sink', glyph: 'puzzle', order: 800, layout: 'single', regions: { body: { kind: 'remote', entry: 'pane' } } },
    // The rectangle this plugin offers into somebody else's `rectangle` point. An `inline` surface
    // registers nothing of its own: the only thing that ever draws it is the owner's pane.
    { target: 'inline', id: 'preview', label: 'Preview' },
  ],
  extensionPoints: [
    { id: 'card-links', label: 'Linked items', kind: 'rows', location: 'pane.footer', surface: 'sink' },
    { id: 'row-note', label: 'Row notes', kind: 'annotation', key: { row: 'string' } },
    { id: 'beside-row', label: 'Beside a row', kind: 'remote', mode: 'replace', selector: 'kind' },
    { id: 'beside-pane', label: 'Beside the pane', kind: 'rectangle', location: 'pane.inline-beside', surface: 'sink', mode: 'replace', selector: 'path' },
    { id: 'before-flush', label: 'flush the sink', kind: 'hook', payload: { reason: 'string' }, allows: ['observe', 'veto'] },
  ],
  extensions: [
    // rows: a strip under another plugin's pane.
    { id: 'links', point: 'board:card-links', label: 'Sink links', items: `/v2/p/${ID}/links` },
    // annotation: a mark on a diff line somebody else drew.
    { id: 'diff-note', point: 'changes:diff-line', label: 'Sink notes', items: `/v2/p/${ID}/marks` },
    // remote: a card in another plugin's slot, drawn from this bundle in a worker.
    { id: 'tool-card', point: 'agents:tool-card', label: 'Sink tool calls', remote: 'toolCard', matches: ['execute'] },
    // rectangle: this plugin's iframe, beside another plugin's document.
    { id: 'md-preview', point: 'editor:beside', label: 'Sink preview', frame: 'preview', matches: ['*.md'] },
    // hook: a turn before another plugin pushes, with the right to say no.
    { id: 'scan-push', point: 'changes:before-push', label: 'Sink push scan', route: `/v2/p/${ID}/scan`, mode: 'veto' },
  ],
}

const manifest = (over: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'Kitchen sink',
  version: '1.0.0',
  apiVersion: PLUGIN_API_MAJOR,
  node: './dist/node.js',
  client: './dist/client.js',
  contributions,
  ...over,
})

const install = (body: unknown = manifest()): string => {
  const target = join(pluginInstallDir(root), ID)
  mkdirSync(join(target, 'dist'), { recursive: true })
  writeFileSync(join(target, 'acorn-plugin.json'), JSON.stringify(body))
  writeFileSync(join(target, 'dist', 'node.js'), `export default { name: ${JSON.stringify(ID)}, init: () => {} }\n`)
  writeFileSync(join(target, 'dist', 'client.js'), 'export function activate() {}\n')
  return target
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acorn five kinds-'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('a plugin declaring all five extension kinds', () => {
  it('loads from disk with every point and every contribution intact', async () => {
    install()
    const result = await loadExternalPlugins(root, { builtins: [] })
    expect(result.failures).toEqual([])
    expect(result.installed).toHaveLength(1)

    const info = installedPluginInfo(result.installed[0]!)
    const points = info.contributions.extensionPoints ?? []
    // Five kinds, one array, and each keeps the fields its own kind needs. A point that lost its
    // `key`, its `mode` or its `payload` on the way through would draw nothing and say nothing.
    expect(points.map((point) => [point.id, point.kind])).toEqual([
      ['card-links', 'rows'],
      ['row-note', 'annotation'],
      ['beside-row', 'remote'],
      ['beside-pane', 'rectangle'],
      ['before-flush', 'hook'],
    ])
    expect(points.find((point) => point.id === 'row-note')?.key).toEqual({ row: 'string' })
    expect(points.find((point) => point.id === 'beside-pane')?.location).toBe('pane.inline-beside')
    expect(points.find((point) => point.id === 'before-flush')?.allows).toEqual(['observe', 'veto'])

    const filled = info.contributions.extensions ?? []
    // Each contribution names its owner out loud, which is the disclosure: a person reading this
    // manifest can see that it reaches into board, changes, agents and editor.
    expect(filled.map((entry) => entry.point)).toEqual([
      'board:card-links',
      'changes:diff-line',
      'agents:tool-card',
      'editor:beside',
      'changes:before-push',
    ])
    // One carrier each, and no contribution carries two.
    expect(filled.map((entry) => [!!entry.items, !!entry.remote, !!entry.frame, !!entry.route])).toEqual([
      [true, false, false, false],
      [true, false, false, false],
      [false, true, false, false],
      [false, false, true, false],
      [false, false, false, true],
    ])
    expect(filled.find((entry) => entry.point === 'changes:before-push')?.mode).toBe('veto')
  })

  it('refuses the whole manifest when one contribution reads a route that is not its own', async () => {
    // The confinement, on the kind where it is easiest to get wrong: `items` and `route` are paths, and
    // a path is the one field a manifest could point at somebody else's namespace.
    install(manifest({
      contributions: {
        ...contributions,
        extensions: [{ id: 'links', point: 'board:card-links', label: 'Sink links', items: '/v2/p/board/links' }],
      },
    }))
    const result = await loadExternalPlugins(root, { builtins: [] })
    expect(result.installed).toEqual([])
    expect(result.failures.map((failure) => failure.id)).toEqual([ID])
    expect(result.failures[0]!.reason).toMatch(/route must be inside \/v2\/p\/kitchen-sink\//)
  })

  it('refuses a hook point that says nothing about what it allows', async () => {
    install(manifest({
      contributions: {
        ...contributions,
        extensionPoints: [{ id: 'before-flush', label: 'flush the sink', kind: 'hook', payload: { reason: 'string' } }],
      },
    }))
    const result = await loadExternalPlugins(root, { builtins: [] })
    expect(result.installed).toEqual([])
    expect(result.failures[0]!.reason).toMatch(/allows/)
  })
})
