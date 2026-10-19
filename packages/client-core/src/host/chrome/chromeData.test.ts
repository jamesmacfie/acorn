import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { MAX_RAW_ANNOTATION_ROWS } from '@acorn/protocol/extensionPoints.ts'
import { setActiveNode } from '../../infra/node/activeNode'

const readJson = vi.fn()
const writeJson = vi.fn()
vi.mock('../../infra/node/apiClient', () => ({
  readJson: (...args: unknown[]) => readJson(...args),
  writeJson: (...args: unknown[]) => writeJson(...args),
}))

const {
  chromeDeps,
  readAnnotationMarks,
  readRailPresentation,
  readRailSearch,
  sanitizeRailItem,
  scopedSourceItemsPath,
  unwatchChrome,
  watchChrome,
} = await import('./chromeData')
const wsClient = await import('../../infra/node/wsClient')
const { _resetPluginChannels } = await import('../plugins/pluginChannel')

describe('descriptor source scope', () => {
  it('adds an encoded active project or workspace while preserving plugin query parameters', () => {
    expect(scopedSourceItemsPath('/v1/p/board/items', { projectId: 'project/one' })).toBe(
      '/v1/p/board/items?project=project%2Fone',
    )
    expect(scopedSourceItemsPath('/v1/p/board/items?status=open', { projectId: 'project-1' })).toBe(
      '/v1/p/board/items?status=open&project=project-1',
    )
    expect(scopedSourceItemsPath('/v1/p/board/items', { workspaceId: 'ws-1' })).toBe('/v1/p/board/items?workspace=ws-1')
    expect(scopedSourceItemsPath('/v1/p/board/items', {})).toBe('/v1/p/board/items')
  })
})

describe('descriptor source search', () => {
  beforeEach(() => readJson.mockReset())

  it("sends the reader's text and the routed project, and sanitizes every row", async () => {
    readJson.mockResolvedValueOnce({ items: [{ id: 'a:1', title: 'Crash' }, { id: 'no title' }], incomplete: true })
    const result = await readRailSearch(
      'linear',
      '/v1/p/linear/rail-search',
      'node-1',
      'crash',
      { projectId: 'project-1' },
      new AbortController().signal,
    )
    expect(readJson.mock.calls[0][0]).toBe('/v1/p/linear/rail-search?project=project-1&q=crash')
    expect(result).toEqual({ items: [{ id: 'a:1', title: 'Crash' }], incomplete: true })
  })

  it('cuts an oversized answer and calls it incomplete', async () => {
    readJson.mockResolvedValueOnce({ items: Array.from({ length: 150 }, (_, at) => ({ id: `r${at}`, title: 'Row' })) })
    const result = await readRailSearch(
      'linear',
      '/v1/p/linear/rail-search',
      'node-1',
      'row',
      {},
      new AbortController().signal,
    )
    expect(result.items).toHaveLength(100)
    expect(result.incomplete).toBe(true)
  })

  it("refuses a search route outside the plugin's namespace", async () => {
    await expect(
      readRailSearch('linear', '/v1/p/rollbar/rail-search', 'node-1', 'x', {}, new AbortController().signal),
    ).rejects.toThrow('linear may not read')
  })
})

describe('descriptor source row parsing', () => {
  it("strips another plugin's task origin without dropping the row", () => {
    expect(
      sanitizeRailItem('rollbar', {
        id: '142',
        title: 'Checkout failed',
        task: { origin: 'linear', title: 'Fix checkout' },
      }),
    ).toEqual({
      id: '142',
      title: 'Checkout failed',
      task: { title: 'Fix checkout' },
    })
  })

  it('keeps exact and namespaced origins owned by the plugin', () => {
    expect(
      sanitizeRailItem('rollbar', {
        id: '142',
        title: 'Checkout failed',
        task: { origin: 'rollbar:error' },
      })?.task?.origin,
    ).toBe('rollbar:error')
  })

  it('keeps positional fields, empty cells included, and drops a malformed list', () => {
    expect(
      sanitizeRailItem('linear', {
        id: 'c:FAST-6352',
        title: 'Planner crash',
        fields: ['FAST-6352', ''],
      }),
    ).toEqual({
      id: 'c:FAST-6352',
      title: 'Planner crash',
      fields: ['FAST-6352', ''],
    })
    expect(
      sanitizeRailItem('linear', {
        id: 'c:FAST-6352',
        title: 'Planner crash',
        fields: ['FAST-6352', 7],
      }),
    ).toEqual({
      id: 'c:FAST-6352',
      title: 'Planner crash',
    })
  })

  it('keeps host-owned row layout and semantic severity values only', () => {
    expect(
      sanitizeRailItem('rollbar', {
        id: '142',
        title: 'Checkout failed',
        fields: ['#142'],
        fieldsFirst: true,
        icon: 'circle-x',
        severity: 'danger',
        badge: '12',
      }),
    ).toEqual({
      id: '142',
      title: 'Checkout failed',
      fields: ['#142'],
      fieldsFirst: true,
      icon: 'circle-x',
      severity: 'danger',
      badge: '12',
    })
    expect(
      sanitizeRailItem('rollbar', {
        id: '142',
        title: 'Checkout failed',
        severity: 'magenta',
        fieldsFirst: 'yes',
      }),
    ).toEqual({ id: '142', title: 'Checkout failed' })
  })

  it('strips a malformed task link while retaining valid task fields', () => {
    expect(
      sanitizeRailItem('rollbar', {
        id: '142',
        title: 'Checkout failed',
        task: { origin: 'rollbar', link: { connectionId: 7 } },
      }),
    ).toEqual({
      id: '142',
      title: 'Checkout failed',
      task: { origin: 'rollbar' },
    })
  })
})

describe('rail presentation answers', () => {
  beforeEach(() => readJson.mockReset())
  const read = () => readRailPresentation('music', '/v1/p/music/now', 'node-a', new AbortController().signal)
  const artwork = { path: '/v1/p/music/art/42', revision: '42', alt: 'Album cover' }

  it('reads a bounded answer from the plugin route and keeps its artwork and words', async () => {
    readJson.mockResolvedValueOnce({ artwork, tooltip: { title: 'Song', detail: 'Artist\nAlbum' }, later: true })
    expect(await read()).toEqual({ artwork, tooltip: { title: 'Song', detail: 'Artist\nAlbum' } })
    expect(readJson).toHaveBeenCalledWith('/v1/p/music/now', expect.objectContaining({ maxResponseBytes: 32 * 1024 }))
    readJson.mockResolvedValueOnce(null)
    expect(await read()).toBeNull()
  })

  it('reads a malformed answer, or one naming another plugin artwork, as the static button', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const answer of [
      { tooltip: { title: 'x'.repeat(81) } },
      { artwork: { ...artwork, revision: '' } },
      { artwork: { ...artwork, path: '/v1/p/other/art/42' } },
      { artwork: { ...artwork, path: 'https://example.com/cover.png' } },
      'Song',
    ]) {
      readJson.mockResolvedValueOnce(answer)
      expect(await read()).toBeNull()
    }
    // What went wrong and where, never the words the plugin sent.
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).toContain('music returned an unusable rail presentation (tooltip.title:')
    expect(logged).toContain("artwork.path: not one of this plugin's routes")
    expect(logged).not.toContain('x'.repeat(20))
    warn.mockRestore()
  })
})

describe('annotation response budget', () => {
  beforeEach(() => writeJson.mockReset())

  it('passes on only the generic raw-row ceiling, unchecked, for the annotation host to sanitize', async () => {
    const rows = Array.from({ length: MAX_RAW_ANNOTATION_ROWS + 2 }, (_, index) =>
      index === 1 ? { broken: true } : { key: { line: index }, severity: 'info', text: `Line ${index}` },
    )
    writeJson.mockResolvedValue({ items: rows })

    const marks = await readAnnotationMarks(
      'coverage',
      '/v1/p/coverage/marks',
      'node-a',
      [{ line: 1 }],
      new AbortController().signal,
    )

    expect(marks).toEqual(rows.slice(0, MAX_RAW_ANNOTATION_ROWS))
  })
})

// The chrome half of the `term:status` split, from the frame to the revision a descriptor read watches.
//
// The amplifier this pins closed: a content-free ping on every terminal's idle-to-working edge would
// make the chrome sweep refetch every plugin's rail rows, badges and collections on every connected
// client.
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
