import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { setActiveNode } from '../../infra/node/activeNode'

const readJson = vi.fn()
vi.mock('../../infra/node/apiClient', () => ({
  readJson: (...args: unknown[]) => readJson(...args),
  writeJson: vi.fn(),
}))

const { chromeDeps, readCollection, sanitizeRailItem, scopedSourceItemsPath, unwatchChrome, watchChrome } = await import('./chromeData')
const wsClient = await import('../../infra/node/wsClient')
const { _resetPluginChannels } = await import('../plugins/pluginChannel')

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

  it('keeps positional fields, empty cells included, and drops a malformed list', () => {
    expect(sanitizeRailItem('linear', {
      id: 'c:FAST-6352', title: 'Planner crash', fields: ['FAST-6352', ''],
    })).toEqual({
      id: 'c:FAST-6352', title: 'Planner crash', fields: ['FAST-6352', ''],
    })
    expect(sanitizeRailItem('linear', {
      id: 'c:FAST-6352', title: 'Planner crash', fields: ['FAST-6352', 7],
    })).toEqual({
      id: 'c:FAST-6352', title: 'Planner crash',
    })
  })

  it('keeps host-owned row layout and semantic severity values only', () => {
    expect(sanitizeRailItem('rollbar', {
      id: '142', title: 'Checkout failed', fields: ['#142'], fieldsFirst: true,
      icon: 'circle-x', severity: 'danger', badge: '12',
    })).toEqual({
      id: '142', title: 'Checkout failed', fields: ['#142'], fieldsFirst: true,
      icon: 'circle-x', severity: 'danger', badge: '12',
    })
    expect(sanitizeRailItem('rollbar', {
      id: '142', title: 'Checkout failed', severity: 'magenta', fieldsFirst: 'yes',
    })).toEqual({ id: '142', title: 'Checkout failed' })
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


// The whole of phase 5's chrome half, from the frame to the revision a descriptor read watches.
//
// The amplifier this pins closed: `term:status` used to be one content-free ping that a terminal
// emitted on every idle-to-working edge, and the chrome sweep answered it by refetching every plugin's
// rail rows, badges and collections on every connected client
// (docs/performance.md § 2026-09-03 — phase 5).
describe('chrome freshness hears only what names it', () => {
  const emit: ((nodeId: string, frame: unknown) => void)[] = []

  beforeEach(() => {
    emit.length = 0
    ;(globalThis as { window?: unknown }).window = {
      acorn: {
        desktop: true,
        nodeFetch: () => Promise.reject(new Error('this suite makes no requests')),
        nodeSend: () => {},
        onNodeFrame: (cb: (nodeId: string, frame: unknown) => void) => {
          emit.push(cb)
          return () => {}
        },
        onNodeStatus: (_cb: (status: NodeStatus) => void) => () => {},
      },
    }
    wsClient._resetWsClient()
    _resetPluginChannels()
    setActiveNode('n1')
    watchChrome(undefined)
  })

  afterEach(() => {
    unwatchChrome()
    wsClient._resetWsClient()
    _resetPluginChannels()
    setActiveNode(null)
    delete (globalThis as { window?: unknown }).window
  })

  const frame = (f: unknown) => emit.forEach((cb) => cb('n1', f))

  it('does not bump any plugin on a terminal session change', () => {
    const board = chromeDeps('board')
    const linear = chromeDeps('linear')
    frame({ channel: 'terminal:sessions-changed' })
    expect(chromeDeps('board')).toBe(board)
    expect(chromeDeps('linear')).toBe(linear)
  })

  it('bumps only the plugin a status ping names', () => {
    const board = chromeDeps('board')
    const linear = chromeDeps('linear')
    frame({ channel: 'term:status', pluginId: 'board' })
    expect(chromeDeps('board')).toBe(board + 1)
    expect(chromeDeps('linear')).toBe(linear)
  })

  // Core's own pings still carry no id, and still mean everyone's: a task created or a worktree
  // appearing can move anybody's rows.
  it('bumps everyone on a ping that names nobody', () => {
    const board = chromeDeps('board')
    const linear = chromeDeps('linear')
    frame({ channel: 'term:status' })
    expect(chromeDeps('board')).toBe(board + 1)
    expect(chromeDeps('linear')).toBe(linear + 1)
  })
})
