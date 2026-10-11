import type { Task } from '../../infra/queries'

// One task, by id, from module-level code.
//
// The task list is a TanStack query and `useQueryClient` is a hook, usable only while a component is
// being set up, so a module-level caller holding a task id needs this to reach the entity. Without
// it `openPluginContentTarget` can't evaluate a pane's `when(task)` predicate, and a content link
// naming a stopped plugin's pane claims the event and renders nothing.
//
// The composition root installs the reader once, because it's the one place that holds the QueryClient
// and knows the app is mounted. Not reactive: every caller is a click handler answering "can this go
// here, right now", and a tracked read from a signal-less cache would be a subscription nobody drops.
//
// `activeTaskId()` is not a substitute: a content link can name a task that isn't the active one.
let read: (taskId: string) => Task | undefined = () => undefined

/** Called once by the composition root, before anything can click. */
export const setTaskLookup = (reader: (taskId: string) => Task | undefined): void => void (read = reader)

/** The task, or undefined when it isn't in the cache. Treat that as "unknown", not "archived": the
 * list may simply not have loaded yet. */
export const taskById = (taskId: string): Task | undefined => read(taskId)
