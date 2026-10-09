import { createMemo, createSignal, untrack, type Accessor, type Setter } from 'solid-js'
import { activeNodeId, onScopeEvicted } from '@acorn/plugin-api/client'

type Entry = { taskId: string | null; signal: [Accessor<unknown>, Setter<unknown>] }
const entries = new Map<string, Entry>()

// Presentation state lives outside mounted views. See docs/state-ownership/scope-rules.md § The scope table.
export function createGitViewSignal<T>(projectId: Accessor<string>, name: Accessor<string>, initial: Accessor<T>,
  taskId: Accessor<string | null> = () => null): [Accessor<T>, Setter<T>] {
  const signal = createMemo(() => {
    const task = taskId()
    const key = JSON.stringify([activeNodeId(), projectId(), task, name()])
    let entry = entries.get(key)
    if (!entry) {
      entry = { taskId: task, signal: createSignal<unknown>(untrack(initial)) }
      entries.set(key, entry)
    }
    return entry.signal
  })
  const read: Accessor<T> = () => signal()[0]() as T
  const write = ((value: unknown) => signal()[1](value)) as Setter<T>
  return [read, write]
}

onScopeEvicted((event) => {
  if (event.scope === 'task') {
    for (const [key, entry] of entries) if (entry.taskId === event.taskId) entries.delete(key)
  }
})
