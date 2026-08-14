import { describe, expect, it } from 'vitest'
import type { PluginDocumentRegion, PluginFrameSurface } from '@acorn/protocol/api.ts'
import { documentRegionFor, isHostOwnedSurface } from './documentSurfaces'

// The line between a surface that RUNS plugin code and one the host draws (docs/future/monaco.md).
// It is the trust gate for a whole class of surface, so it is worth pinning in both directions: a
// frame stays behind the bytes-hash prompt, a document surface does not need one, and neither gets to
// name a route outside its own plugin.

const surface = (over: Partial<PluginFrameSurface> = {}): PluginFrameSurface => ({
  target: 'pane', id: 'board', label: 'Board', glyph: 'kanban', order: 500, formFactor: ['desktop'], ...over,
})

const withDocument = (document: Omit<PluginDocumentRegion, 'languageId'>) =>
  surface({ id: 'scratch', layout: { template: 'document', document: { languageId: 'sql', ...document } } })

describe('isHostOwnedSurface', () => {
  it('is true only for a pane whose whole rectangle the host draws', () => {
    expect(isHostOwnedSurface(withDocument({ read: '/v2/p/board/doc' }))).toBe(true)
    // A plain frame — every manifest written before this contract existed.
    expect(isHostOwnedSurface(surface())).toBe(false)
    expect(isHostOwnedSurface(surface({ target: 'overlay' }))).toBe(false)
    expect(isHostOwnedSurface(surface({ target: 'webview', url: 'https://x.test', hosts: ['x.test'] }))).toBe(false)
  })

  // The distinction the whole gate exists for: half a composed pane IS the plugin's bundle in an
  // iframe, so it needs an accepted bytes hash exactly like any other frame. A composed pane is not a
  // cheaper way to run untrusted code.
  it('is false for the composed template, which draws the plugin\'s own frame in half the rectangle', () => {
    const composed = surface({
      id: 'query',
      layout: { template: 'document-over-frame', document: { languageId: 'sql', read: '/v2/p/board/doc' } },
    })
    expect(isHostOwnedSurface(composed)).toBe(false)
  })
})

describe('documentRegionFor', () => {
  it('answers null for a surface that declares no document', () => {
    expect(documentRegionFor('board', surface())).toBeNull()
  })

  it('returns the region for routes inside the plugin namespace', () => {
    const region = documentRegionFor('board', withDocument({ read: '/v2/p/board/doc', write: '/v2/p/board/doc' }))
    expect(region).toEqual({ languageId: 'sql', read: '/v2/p/board/doc', write: '/v2/p/board/doc' })
  })

  it('refuses a read route outside the namespace, because a roster row is bytes a node sent', () => {
    expect(() => documentRegionFor('board', withDocument({ read: '/v2/core/tasks' }))).toThrow(/outside board/)
    expect(() => documentRegionFor('board', withDocument({ read: '/v2/p/other/doc' }))).toThrow(/outside board/)
    // Dot segments are normalised before the check, so an apparently-owned path cannot escape.
    expect(() => documentRegionFor('board', withDocument({ read: '/v2/p/board/../other/doc' }))).toThrow(/outside board/)
  })

  it('refuses an escaping WRITE route even when the read route is fine', () => {
    expect(() => documentRegionFor('board', withDocument({ read: '/v2/p/board/doc', write: '/v2/p/other/doc' })))
      .toThrow(/write route/)
  })

  // A capability route is a route like any other: the host POSTs to it on the plugin's behalf on every
  // completion trigger, so it is confined on the same terms as the two above.
  it('refuses an escaping COMPLETIONS route', () => {
    expect(() => documentRegionFor('board', withDocument({ read: '/v2/p/board/doc', completions: { route: '/v2/core/tasks', triggerCharacters: [] } })))
      .toThrow(/completions route/)
    expect(documentRegionFor('board', withDocument({ read: '/v2/p/board/doc', completions: { route: '/v2/p/board/complete', triggerCharacters: [] } })))
      .toMatchObject({ completions: { route: '/v2/p/board/complete' } })
  })
})
