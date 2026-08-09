import { describe, expect, it } from 'vitest'
import { pluginManifestSchema } from './pluginManifest'

// The declarative-chrome half of the manifest (docs/plugins.md).
//
// What is worth pinning here is not the field list — Zod holds that — but the three cross-field rules,
// because each one is a place a manifest could otherwise name something outside itself: a route in
// someone else's namespace, a pane it never declared, a non-https URL the shell would hand to the OS.

const manifest = (contributions: Record<string, unknown>) =>
  pluginManifestSchema.safeParse({ id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', contributions })

const permissionManifest = (permissions: Record<string, unknown>) =>
  pluginManifestSchema.safeParse({ id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', permissions })

const messages = (result: ReturnType<typeof manifest>) =>
  result.success ? [] : result.error.issues.map((issue) => issue.message)

const PANE = { target: 'pane', id: 'board', label: 'Board' }

describe('permission identifier shape', () => {
  it('bounds scope and event strings before they can reach the trust layout', () => {
    expect(permissionManifest({ api: ['x'.repeat(65)] }).success).toBe(false)
    expect(permissionManifest({ events: ['not an event'] }).success).toBe(false)
    expect(permissionManifest({ events: [`runtime:${'x'.repeat(64)}`] }).success).toBe(false)
  })

  it('keeps unknown but well-formed requests forward compatible', () => {
    const result = permissionManifest({ api: ['core.quantum:read'], events: ['runtime:quantum-shift'] })
    expect(result.success).toBe(true)
  })
})

describe('webview surfaces', () => {
  it('accepts literal and plugin-route URL sources', () => {
    expect(manifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', url: 'https://docs.example.com/start', hosts: ['docs.example.com'] }],
    }).success).toBe(true)
    expect(manifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', urlSource: '/v2/p/board/webview-url', hosts: ['*.example.com'] }],
    }).success).toBe(true)
  })

  it('requires exactly one URL form and confines a source route to the plugin', () => {
    expect(manifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', hosts: ['docs.example.com'] }],
    }).success).toBe(false)
    expect(manifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', url: 'https://docs.example.com', urlSource: '/v2/p/board/url', hosts: ['docs.example.com'] }],
    }).success).toBe(false)
    expect(messages(manifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', urlSource: '/v2/p/other/url', hosts: ['docs.example.com'] }],
    }))).toContain('route must be inside /v2/p/board/')
  })

  it('validates hosts and requires a literal URL to stay inside them', () => {
    expect(manifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', url: 'https://other.example.com', hosts: ['docs.example.com'] }],
    }).success).toBe(false)
    expect(manifest({
      frames: [{ target: 'webview', id: 'docs', label: 'Docs', url: 'https://docs.example.com', hosts: ['*.*.example.com'] }],
    }).success).toBe(false)
    expect(manifest({
      frames: [{ target: 'webview', id: 'local', label: 'Local', url: 'http://localhost:3000', hosts: ['localhost'] }],
    }).success).toBe(true)
    expect(manifest({
      frames: [{ target: 'webview', id: 'remote', label: 'Remote', url: 'http://docs.example.com', hosts: ['docs.example.com'] }],
    }).success).toBe(false)
  })
})

describe('migration entrypoint confinement', () => {
  it('accepts a relative migrations directory and rejects escapes', () => {
    expect(pluginManifestSchema.safeParse({
      id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', migrations: './migrations',
    }).success).toBe(true)
    expect(pluginManifestSchema.safeParse({
      id: 'board', name: 'Board', version: '1.0.0', apiVersion: '1', migrations: '../other/migrations',
    }).success).toBe(false)
  })
})

describe('chrome descriptors', () => {
  it('accepts a chrome-only manifest with no frames at all', () => {
    const result = manifest({
      sources: [{ id: 'board', label: 'Board', glyph: 'kanban', order: 60, items: '/v2/p/board/rail-items' }],
      slots: [{ id: 'board-footer', slot: 'footer', data: '/v2/p/board/badge' }],
      palette: [{ id: 'board.new', title: 'Board: new card', action: { verb: 'runNodeAction', path: '/v2/p/board/new' } }],
      attention: [{ id: 'board-stuck', items: '/v2/p/board/attention' }],
      nodeStats: [{ id: 'board-count', label: ['card stuck', 'cards stuck'], data: '/v2/p/board/stat' }],
    })
    expect(result.success).toBe(true)
    // Defaults land, so the client never has to reason about an absent order.
    expect(result.success && result.data.contributions.attention[0]?.order).toBe(500)
    expect(result.success && result.data.contributions.frames).toEqual([])
  })

  it('defaults every chrome key to an empty array, so a phase-3 manifest still parses', () => {
    const result = manifest({ frames: [PANE] })
    expect(result.success && result.data.contributions.sources).toEqual([])
    expect(result.success && result.data.contributions.nodeStats).toEqual([])
    expect(result.success && result.data.contributions.contentLinks).toEqual([])
  })

  it('confines every route to the plugin’s own namespace', () => {
    expect(messages(manifest({ sources: [{ id: 's', label: 'S', order: 1, items: '/v2/core/tasks' }] })))
      .toEqual(['route must be inside /v2/p/board/'])
    // Another plugin's namespace is the interesting case: it looks legal and is the whole point of the check.
    expect(messages(manifest({ attention: [{ id: 'a', items: '/v2/p/github/attention' }] })))
      .toEqual(['route must be inside /v2/p/board/'])
    // A prefix match is not a namespace match.
    expect(messages(manifest({ nodeStats: [{ id: 'n', label: ['x', 'y'], data: '/v2/p/board-other/stat' }] })))
      .toEqual(['route must be inside /v2/p/board/'])
    expect(messages(manifest({ attention: [{ id: 'a', items: '/v2/p/board/../other/items' }] })))
      .toEqual(['route must be inside /v2/p/board/'])
    // `runNodeAction` carries a route too, and it is checked wherever an action can appear.
    expect(messages(manifest({ palette: [{ id: 'p', title: 'P', action: { verb: 'runNodeAction', path: '/v2/p/other/go' } }] })))
      .toEqual(['route must be inside /v2/p/board/'])
  })

  it('rejects an openPane naming a pane the manifest does not declare', () => {
    const bad = manifest({ sources: [{ id: 's', label: 'S', order: 1, items: '/v2/p/board/items', onSelect: { verb: 'openPane', pane: 'diff' } }] })
    expect(messages(bad)).toEqual([`openPane names 'diff', which this manifest does not declare as a pane`])

    const good = manifest({
      frames: [PANE],
      sources: [{ id: 's', label: 'S', order: 1, items: '/v2/p/board/items', onSelect: { verb: 'openPane', pane: 'board' } }],
    })
    expect(good.success).toBe(true)
  })

  it('rejects a settings surface being used as an openPane target', () => {
    const bad = manifest({
      frames: [{ target: 'settings', id: 'board-settings', label: 'Board' }],
      palette: [{ id: 'p', title: 'P', action: { verb: 'openPane', pane: 'board-settings' } }],
    })
    expect(bad.success).toBe(false)
  })

  it('rejects a non-https openUrl', () => {
    expect(manifest({ palette: [{ id: 'p', title: 'P', action: { verb: 'openUrl', url: 'https://example.com/x' } }] }).success).toBe(true)
    expect(manifest({ palette: [{ id: 'p', title: 'P', action: { verb: 'openUrl', url: 'http://example.com/x' } }] }).success).toBe(false)
  })

  it('rejects an unknown slot and an unknown verb', () => {
    expect(manifest({ slots: [{ id: 'x', slot: 'statusbar', data: '/v2/p/board/badge' }] }).success).toBe(false)
    // `invoke` is a v1 non-verb (it needs a frame lifecycle the shell does not have). Failing here is the
    // point: an author is told, rather than shipping a palette row that silently does nothing.
    expect(manifest({ palette: [{ id: 'p', title: 'P', action: { verb: 'invoke', id: 'new-card' } }] }).success).toBe(false)
  })

  it('accepts the host-owned createTask verb without embedding executable steps', () => {
    const result = manifest({
      sources: [{
        id: 'board',
        label: 'Board',
        order: 60,
        items: '/v2/p/board/rail-items',
        onSelect: { verb: 'createTask' },
      }],
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.contributions.sources[0]?.onSelect).toEqual({ verb: 'createTask' })
  })

  it('rejects a duplicate contribution id across descriptor kinds', () => {
    const bad = manifest({ frames: [PANE], slots: [{ id: 'board', slot: 'footer', data: '/v2/p/board/badge' }] })
    expect(messages(bad)).toEqual([`duplicate contribution id 'board'`])
  })

  it('floors the polling fallback so a descriptor cannot busy-loop a remote node', () => {
    expect(manifest({ slots: [{ id: 'x', slot: 'footer', data: '/v2/p/board/badge', refresh: 30 }] }).success).toBe(true)
    expect(manifest({ slots: [{ id: 'x', slot: 'footer', data: '/v2/p/board/badge', refresh: 5 }] }).success).toBe(false)
  })

  it('validates declarative content links against their declared pane and capture', () => {
    const good = manifest({
      frames: [PANE],
      contentLinks: [{
        id: 'board.card',
        match: 'https://*.board.example/cards/{key}',
        openPane: 'board',
        item: 'key',
      }],
    })
    expect(good.success).toBe(true)

    expect(messages(manifest({
      contentLinks: [{
        id: 'board.card', match: 'https://board.example/cards/{key}', openPane: 'missing', item: 'key',
      }],
    }))).toContain(`content link names 'missing', which this manifest does not declare as a pane`)

    expect(messages(manifest({
      frames: [PANE],
      contentLinks: [{
        id: 'board.card', match: 'https://board.example/cards/{key}', openPane: 'board', item: 'id',
      }],
    }))).toContain(`content link item 'id' is not captured by its match pattern`)
  })
})
