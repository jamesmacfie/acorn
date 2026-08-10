import type { Task } from '../queries'

// One task, by id, from module-level code.
//
// The task LIST is a TanStack query (`tasksOptions`), and `useQueryClient` is a hook — usable only
// while a component is being set up. So the handful of module-level callers that hold a task id and
// nothing else had no way to reach the entity, and the visible cost of that was a silent dead click:
// `openPluginContentTarget` could not evaluate a pane's `when(task)` predicate, so a content link
// naming a pane whose plugin is stopped claimed the event and then rendered nothing
// (docs/third-party § known issues).
//
// The composition root installs the reader once, because it is the one place that both holds the
// QueryClient and knows the whole app is mounted. Deliberately NOT reactive: every caller is a click
// handler answering "can this go here, right now", and a Solid-tracked read from a signal-less cache
// would be a subscription nobody unsubscribes.
//
// `activeTaskId()` is not a substitute and must not be used as one — a content link can name a task
// that is not the active one, which is exactly when getting it wrong is invisible.
let read: (taskId: string) => Task | undefined = () => undefined

/** Called once by the composition root, before anything can click. */
export const setTaskLookup = (reader: (taskId: string) => Task | undefined): void => void (read = reader)

/** The task, or undefined when it is not in the cache — a caller must treat that as "unknown", not
 * "archived": the list may simply not have loaded yet. */
export const taskById = (taskId: string): Task | undefined => read(taskId)
