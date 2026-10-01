// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { setActiveNode } from '@acorn/plugin-api/client'
import { refreshFleet } from '@acorn/plugin-api/testkit/client'
import { notesApi } from './notesClient'
import { notesSelectionFor, rememberNotesSelection } from './notesPaneState'

afterEach(() => { setActiveNode(null); delete (window as { acorn?: unknown }).acorn })

it('keeps every deferred verb on its captured Node and partitions remembered equal task IDs', async () => {
  const calls: { nodeId: string; path: string; method: string }[] = []
  Object.assign(window, { acorn: {
    desktop: true, onNodeStatus: () => () => {},
    fleetList: async () => ({ nodes: ['a', 'b'].map((nodeId) => ({ nodeId, endpoint: 'https://127.0.0.1:1', label: nodeId, local: false })), statuses: ['a', 'b'].map((nodeId) => ({ nodeId, state: 'online' })) }),
    nodeFetch: async (nodeId: string, request: { path: string; method: string }) => {
      calls.push({ nodeId, path: request.path, method: request.method })
      return { status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify({ ok: true })) }
    },
  } })
  await refreshFleet()
  setActiveNode('a')
  const a = notesApi()
  rememberNotesSelection('same', { scope: 'task', slug: 'a' }, 'a')
  setActiveNode('b')
  rememberNotesSelection('same', { scope: 'task', slug: 'b' }, 'b')
  const location = { scope: 'task', taskId: 'same' } as const
  await a.list(location); await a.read(location, 'same'); await a.create(location, 'scratch', 'scratch')
  await a.write(location, 'same', 'body'); await a.setTitle(location, 'same', 'title')
  await a.setIncluded(location, 'same', false); await a.remove(location, 'same')
  expect(calls).toHaveLength(7)
  expect(calls.every((call) => call.nodeId === 'a')).toBe(true)
  expect(notesSelectionFor('same', 'a')?.slug).toBe('a')
  expect(notesSelectionFor('same', 'b')?.slug).toBe('b')
  const noTarget = notesApi(null)
  await expect(noTarget.read(location, 'same')).rejects.toMatchObject({ code: 'no_active_node' })
  expect(calls).toHaveLength(7)
})
