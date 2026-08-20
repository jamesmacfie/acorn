import { describe, expect, it, vi } from 'vitest'

const readJson = vi.fn()
vi.mock('../../apiClient', () => ({
  readJson: (...args: unknown[]) => readJson(...args),
  writeJson: vi.fn(),
}))

const { readCollection, sanitizeRailItem, scopedSourceItemsPath } = await import('./data')

describe('descriptor source scope', () => {
  it('adds an encoded active project while preserving plugin query parameters', () => {
    expect(scopedSourceItemsPath('/v2/p/board/items', 'project/one'))
      .toBe('/v2/p/board/items?project=project%2Fone')
    expect(scopedSourceItemsPath('/v2/p/board/items?status=open', 'project-1'))
      .toBe('/v2/p/board/items?status=open&project=project-1')
    expect(scopedSourceItemsPath('/v2/p/board/items', undefined))
      .toBe('/v2/p/board/items')
  })
})

describe('descriptor source row parsing', () => {
  it('strips another plugin\'s task origin without dropping the row', () => {
    expect(sanitizeRailItem('rollbar', {
      id: '142', title: 'Checkout failed', task: { origin: 'linear', title: 'Fix checkout' },
    })).toEqual({
      id: '142', title: 'Checkout failed', task: { title: 'Fix checkout' },
    })
  })

  it('keeps exact and namespaced origins owned by the plugin', () => {
    expect(sanitizeRailItem('rollbar', {
      id: '142', title: 'Checkout failed', task: { origin: 'rollbar:error' },
    })?.task?.origin).toBe('rollbar:error')
  })

  it('strips a malformed task link while retaining valid task fields', () => {
    expect(sanitizeRailItem('rollbar', {
      id: '142', title: 'Checkout failed', task: { origin: 'rollbar', link: { connectionId: 7 } },
    })).toEqual({
      id: '142', title: 'Checkout failed', task: { origin: 'rollbar' },
    })
  })
})

describe('collection reads', () => {
  const ROUTE = '/v2/p/board/collections/cards-mine'
  const body = (rows: unknown[]) => ({
    schema: { fields: [{ id: 'title', name: 'Title', type: 'text', role: 'title' }] },
    rows,
  })

  it('stamps provenance from the contribution, not from the body', () => {
    readJson.mockResolvedValueOnce(body([{ id: 'card-1', values: { title: 'Ship it' } }]))
    return readCollection('board', 'cards-mine', ROUTE, 'node-1', {}, new AbortController().signal)
      .then((page) => {
        expect(page.rows).toEqual([{ id: 'card-1', values: { title: 'Ship it' }, pluginId: 'board', collectionId: 'cards-mine' }])
      })
  })

  it('cannot be talked out of the stamp by a row that names its own source', async () => {
    // The schema does not carry the two fields at all, so a body stating them loses them at the parse.
    // The stamp is not overwritten, it is the only thing that was ever there. A row that could name
    // its own plugin could put its items behind a stranger's badge and its clicks into a stranger's pane.
    readJson.mockResolvedValueOnce(body([{
      id: 'card-1', values: { title: 'Ship it' }, pluginId: 'linear', collectionId: 'issues-mine',
    }]))
    const page = await readCollection('board', 'cards-mine', ROUTE, 'node-1', {}, new AbortController().signal)
    expect(page.rows[0]?.pluginId).toBe('board')
    expect(page.rows[0]?.collectionId).toBe('cards-mine')
  })

  it('answers an unusable page with an empty one and a warning, never a throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // All-or-nothing, deliberately: one row missing its id would otherwise cost the page that row
    // silently, and a complete-looking list that is missing the thing someone was looking for is worse
    // than a list that is plainly empty.
    readJson.mockResolvedValueOnce(body([
      { id: 'card-1', values: { title: 'Ship it' } },
      { values: { title: 'No identity' } },
    ]))
    const page = await readCollection('board', 'cards-mine', ROUTE, 'node-1', {}, new AbortController().signal)
    expect(page).toEqual({ schema: { fields: [] }, rows: [] })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('passes declared params as query parameters and refuses a route outside the namespace', async () => {
    readJson.mockResolvedValueOnce(body([]))
    await readCollection('board', 'cards-mine', ROUTE, 'node-1', { lane: 'doing/now' }, new AbortController().signal)
    expect(readJson.mock.lastCall?.[0]).toBe(`${ROUTE}?lane=doing%2Fnow`)

    await expect(readCollection('board', 'cards-mine', '/v2/p/linear/collections/issues-mine', 'node-1', {}, new AbortController().signal))
      .rejects.toThrow('board may not read')
  })
})
