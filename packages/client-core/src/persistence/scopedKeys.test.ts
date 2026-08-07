import { afterEach, describe, expect, it } from 'vitest'
import { setActiveNode } from '../node/activeNode'
import { scopeIdFromStorageKey, storageKeyFor } from './persistedState'

// docs/ui-design.md § State ownership: "All keys that touch node resources include the nodeId." Task and workspace ids are
// node-minted UUIDs, and docs/architecture-overview.md § Fleet semantics says two nodes may hold the same one — so a bare
// task id in a storage key was the collision it forbids. `storageKeyFor` and `scopeIdFromStorageKey` are the
// ONLY places a nodeId enters or leaves a key, so these are the only cases needed.

const taskSlice = { key: 'core:task-layouts', scope: 'task' as const }
const appSlice = { key: 'last_source', scope: 'app' as const }

afterEach(() => setActiveNode(null))

describe('storageKeyFor', () => {
  it('qualifies a node-resource scope with the active node', () => {
    setActiveNode('node-a')
    expect(storageKeyFor(taskSlice, 'task-1')).toBe('core:task-layouts:node-a/task-1')
  })

  it('leaves the app scope alone', () => {
    // `last_source` and `left_collapsed` describe the WINDOW. Node-qualifying them would reset the rail's
    // collapse state on every node switch, which is the opposite of what the qualification is for.
    setActiveNode('node-a')
    expect(storageKeyFor(appSlice, '')).toBe('last_source')
  })

  it('writes an unqualified key when no node is selected', () => {
    // The `dev:node` case: served directly by a node, so there is no nodeId to qualify with and the origin IS
    // the node.
    expect(storageKeyFor(taskSlice, 'task-1')).toBe('core:task-layouts:task-1')
  })
})

describe('scopeIdFromStorageKey', () => {
  it('round-trips its own output', () => {
    setActiveNode('node-a')
    expect(scopeIdFromStorageKey(taskSlice, storageKeyFor(taskSlice, 'task-1'))).toBe('task-1')
  })

  it('REFUSES another node\'s key, so its layouts cannot hydrate into this node\'s store', () => {
    // The whole point. Two nodes holding a task with the same UUID is legal by construction; without this
    // filter the restore would load node B's pane layout for node A's task.
    setActiveNode('node-a')
    expect(scopeIdFromStorageKey(taskSlice, 'core:task-layouts:node-b/task-1')).toBeNull()
  })

  it('accepts an UNQUALIFIED key whatever the active node', () => {
    setActiveNode('node-a')
    expect(scopeIdFromStorageKey(taskSlice, 'core:task-layouts:task-1')).toBe('task-1')
  })

  it('handles a scope id that itself contains a slash', () => {
    // A pane scope is a composite, so this is not hypothetical. Encoding the pair as one string would make
    // `<node>/<scope>` indistinguishable from a scope id with a slash in it — which is exactly the bug an
    // existing startupRestore case caught.
    setActiveNode('node-a')
    const key = storageKeyFor(taskSlice, 'task-1/pane-2')
    expect(key).toBe('core:task-layouts:node-a/task-1%2Fpane-2')
    expect(scopeIdFromStorageKey(taskSlice, key)).toBe('task-1/pane-2')
  })

  it('is null for another slice\'s key and for junk', () => {
    setActiveNode('node-a')
    expect(scopeIdFromStorageKey(taskSlice, 'editor:open-files:node-a/task-1')).toBeNull()
    expect(scopeIdFromStorageKey(taskSlice, 'core:task-layouts:%E0%A4%A')).toBeNull()
  })

  it('still resolves the app scope by exact key', () => {
    expect(scopeIdFromStorageKey(appSlice, 'last_source')).toBe('')
    expect(scopeIdFromStorageKey(appSlice, 'last_source:x')).toBeNull()
  })
})
