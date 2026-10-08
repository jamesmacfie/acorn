import { expect, it, vi } from 'vitest'
import { clientEvents } from '@acorn/plugin-api/client'
import { historyIsCurrent, historyStep, navigate, nextClosed, noteActivated, noteClosed, recentFiles, reconcileEditorMetadata, takeClosedIfCurrent } from './editorNavigation'

const place = (path: string, line = 1) => ({ path, line, column: 1, scroll: 0 })
const takeClosed = (node: string, task: string) => {
  const tab = nextClosed(node, task)
  if (tab) takeClosedIfCurrent(node, task, tab)
  return tab
}

it('branches navigation after back and reconciles closed references through a folder rename', () => {
  const node = 'navigation-test-node'; const task = 'navigation-test-task'
  navigate(node, task, place('src/a.ts'), place('src/b.ts'))
  navigate(node, task, place('src/b.ts'), place('src/c.ts'))
  expect(historyStep(node, task, -1)).toEqual(place('src/b.ts'))
  navigate(node, task, place('src/b.ts'), place('src/d.ts'))
  expect(historyStep(node, task, 1)).toBeUndefined()
  noteClosed(node, task, { path: 'src/d.ts', index: 2 })
  noteActivated(node, task, 'src/d.ts')
  reconcileEditorMetadata(node, task, 'src', 'renamed')
  expect(takeClosed(node, task)).toEqual({ path: 'renamed/d.ts', index: 2 })
  expect(recentFiles(node, task)).toEqual(['renamed/d.ts'])
  expect(historyStep(node, task, -1)).toEqual(place('renamed/b.ts'))
  reconcileEditorMetadata(node, task, 'renamed')
  expect(recentFiles(node, task)).toEqual([])
})

it('bounds recency and close metadata independently by Node and task', () => {
  const node = 'bounded-test-node'; const task = 'bounded-test-task'
  for (let index = 0; index < 60; index++) {
    noteActivated(node, task, `file-${index}`)
    noteClosed(node, task, { path: `file-${index}`, index })
  }
  expect(recentFiles(node, task)).toHaveLength(50)
  expect(recentFiles('another-node', task)).toEqual([])
  expect(recentFiles(node, 'another-task')).toEqual([])
  for (let index = 59; index >= 40; index--) expect(takeClosed(node, task)?.path).toBe(`file-${index}`)
  expect(takeClosed(node, task)).toBeUndefined()
})

it('invalidates pending replay and reopen references when their paths move', () => {
  const node = 'pending-mutation-node'; const task = 'pending-mutation-task'
  navigate(node, task, place('src/a.ts'), place('src/b.ts'))
  const oldPlace = historyStep(node, task, -1)!
  noteClosed(node, task, { path: 'src/a.ts', index: 0 })
  const oldClosed = nextClosed(node, task)!
  reconcileEditorMetadata(node, task, 'src', 'renamed')
  expect(historyIsCurrent(node, task, oldPlace)).toBe(false)
  expect(takeClosedIfCurrent(node, task, oldClosed)).toBe(false)
  expect(nextClosed(node, task)?.path).toBe('renamed/a.ts')
})

it('writes device recency under the Node/task address and prunes it on archive', () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
  })
  try {
    noteActivated(null, 'archived-editor-task', 'src/a.ts')
    expect(values.get('acorn:editor:recent:v1::archived-editor-task')).toBe('["src/a.ts"]')
    clientEvents.emit('runtime:task-archived', { taskId: 'archived-editor-task' })
    expect(values.has('acorn:editor:recent:v1::archived-editor-task')).toBe(false)
    noteActivated('removed-editor-node', 'first', 'src/a.ts')
    noteActivated('removed-editor-node', 'second', 'src/b.ts')
    noteActivated('retained-editor-node', 'first', 'src/keep.ts')
    clientEvents.emit('runtime:node-removed', { nodeId: 'removed-editor-node' })
    expect([...values.keys()]).toEqual(['acorn:editor:recent:v1:retained-editor-node:first'])
    reconcileEditorMetadata(null, 'archived-editor-task', 'src', 'moved')
    expect(values.has('acorn:editor:recent:v1::archived-editor-task')).toBe(false)
  } finally { vi.unstubAllGlobals() }
})
