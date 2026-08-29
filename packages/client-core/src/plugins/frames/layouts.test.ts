import { describe, expect, it } from 'vitest'
import type { PluginDocumentRegion, PluginFrameSurface } from '@acorn/protocol/api.ts'
import { isHostOwnedSurface, paneLayoutFor } from './layouts'

// The line between a pane that runs plugin code and one the host draws (docs/panes.md § Layout model).
// It is the trust gate for a whole class of surface, so it is worth pinning in both directions: a
// frame stays behind the bytes-hash prompt, a host-drawn pane does not need one, and neither gets to
// name a route outside its own plugin.
//
// The layout name and the region set are re-checked here as well, for the same reason the routes are:
// the manifest reached this device as a roster row, which is bytes a node sent.

const surface = (over: Partial<PluginFrameSurface> = {}): PluginFrameSurface => ({
  target: 'pane', id: 'board', label: 'Board', glyph: 'kanban', order: 500, formFactor: ['desktop'], ...over,
})

const document = (region: Omit<PluginDocumentRegion, 'languageId'>) =>
  ({ kind: 'document', languageId: 'sql', ...region } as const)

const withDocument = (region: Omit<PluginDocumentRegion, 'languageId'>) =>
  surface({ id: 'scratch', layout: 'single', regions: { body: document(region) } })

const composed = surface({
  id: 'query',
  layout: 'document-over-frame',
  regions: { document: document({ read: '/v2/p/board/doc' }), frame: 'frame' },
})

describe('isHostOwnedSurface', () => {
  it('is true only for a pane whose whole rectangle the host draws', () => {
    expect(isHostOwnedSurface(withDocument({ read: '/v2/p/board/doc' }))).toBe(true)
    // A plain frame: every manifest written before this contract existed.
    expect(isHostOwnedSurface(surface())).toBe(false)
    expect(isHostOwnedSurface(surface({ target: 'overlay' }))).toBe(false)
    expect(isHostOwnedSurface(surface({ target: 'webview', url: 'https://x.test', hosts: ['x.test'] }))).toBe(false)
  })

  // The distinction the whole gate exists for: half a composed pane IS the plugin's bundle in an
  // iframe, so it needs an accepted bytes hash exactly like any other frame. A composed pane is not a
  // cheaper way to run untrusted code.
  it("is false for a pane with a frame region, which draws the plugin's own bundle in half the rectangle", () => {
    expect(isHostOwnedSurface(composed)).toBe(false)
  })
})

describe('paneLayoutFor', () => {
  it('answers null for a surface that declares no layout', () => {
    expect(paneLayoutFor('board', surface())).toBeNull()
  })

  it('returns the layout and its regions for routes inside the plugin namespace', () => {
    const declared = paneLayoutFor('board', withDocument({ read: '/v2/p/board/doc', write: '/v2/p/board/doc' }))
    expect(declared).toEqual({
      layout: 'single',
      regions: { body: { kind: 'document', languageId: 'sql', read: '/v2/p/board/doc', write: '/v2/p/board/doc' } },
    })
  })

  it('refuses a layout name and a region set this build does not draw', () => {
    expect(() => paneLayoutFor('board', surface({ layout: 'carousel', regions: { body: 'frame' } })))
      .toThrow(/not a layout this build draws/)
    expect(() => paneLayoutFor('board', surface({ layout: 'list-detail', regions: { list: 'frame' } })))
      .toThrow(/needs a detail region/)
    expect(() => paneLayoutFor('board', surface({ layout: 'single', regions: { body: 'frame', extra: 'frame' } })))
      .toThrow(/has no extra region/)
  })

  it('refuses a read route outside the namespace, because a roster row is bytes a node sent', () => {
    expect(() => paneLayoutFor('board', withDocument({ read: '/v2/core/tasks' }))).toThrow(/outside board/)
    expect(() => paneLayoutFor('board', withDocument({ read: '/v2/p/other/doc' }))).toThrow(/outside board/)
    // Dot segments are normalised before the check, so an apparently-owned path cannot escape.
    expect(() => paneLayoutFor('board', withDocument({ read: '/v2/p/board/../other/doc' }))).toThrow(/outside board/)
  })

  it('refuses an escaping WRITE route even when the read route is fine', () => {
    expect(() => paneLayoutFor('board', withDocument({ read: '/v2/p/board/doc', write: '/v2/p/other/doc' })))
      .toThrow(/write route/)
  })

  // A capability route is a route like any other: the host POSTs to it on the plugin's behalf on every
  // completion trigger, so it is confined on the same terms as the two above.
  it('refuses an escaping COMPLETIONS route', () => {
    expect(() => paneLayoutFor('board', withDocument({ read: '/v2/p/board/doc', completions: { route: '/v2/core/tasks', triggerCharacters: [] } })))
      .toThrow(/completions route/)
    expect(paneLayoutFor('board', withDocument({ read: '/v2/p/board/doc', completions: { route: '/v2/p/board/complete', triggerCharacters: [] } })))
      .toMatchObject({ regions: { body: { completions: { route: '/v2/p/board/complete' } } } })
  })
})
