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

const { chromeDeps, readAnnotationMarks, sanitizeRailItem, scopedSourceItemsPath, unwatchChrome, watchChrome } = await import('./chromeData')
const wsClient = await import('../../infra/node/wsClient')
const { _resetPluginChannels } = await import('../plugins/pluginChannel')

describe('descriptor source scope', () => {
  it('adds an encoded active project while preserving plugin query parameters', () => {
    expect(scopedSourceItemsPath('/v1/p/board/items', 'project/one'))
      .toBe('/v1/p/board/items?project=project%2Fone')
    expect(scopedSourceItemsPath('/v1/p/board/items?status=open', 'project-1'))
      .toBe('/v1/p/board/items?status=open&project=project-1')
    expect(scopedSourceItemsPath('/v1/p/board/items', undefined))
      .toBe('/v1/p/board/items')
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

describe('annotation response budget', () => {
  beforeEach(() => writeJson.mockReset())

  it('inspects only the generic raw-row ceiling and keeps valid rows around malformed ones', async () => {
    const rows = Array.from({ length: MAX_RAW_ANNOTATION_ROWS + 2 }, (_, index) =>
      index === 1
        ? { broken: true }
        : { key: { line: index }, severity: 'info', text: `Line ${index}` })
    writeJson.mockResolvedValue({ items: rows })

    const marks = await readAnnotationMarks(
      'coverage',
      '/v1/p/coverage/marks',
      'node-a',
      [{ line: 1 }],
      new AbortController().signal,
    )

    expect(marks).toHaveLength(MAX_RAW_ANNOTATION_ROWS - 1)
    expect(marks.some((mark) => mark.text === 'Line 2')).toBe(true)
    expect(marks.some((mark) => mark.text === `Line ${MAX_RAW_ANNOTATION_ROWS}`)).toBe(false)
  })
})

// The chrome half of the `term:status` split, from the frame to the revision a descriptor read watches.
//
// The amplifier this pins closed: `term:status` used to be one content-free ping that a terminal
// emitted on every idle-to-working edge, and the chrome sweep answered it by refetching every plugin's
// rail rows, badges and collections on every connected client.
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
