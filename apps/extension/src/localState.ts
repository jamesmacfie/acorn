import type { BrowserApi } from './browser'
import type { PageCapture } from './capture'

// What the sidebar keeps in this browser profile's storage: unsent drafts, the item waiting for each
// task's first conversation, the destination it last showed on each Node, the tab last picked in each
// task, and the workspace Home lists. None of it leaves the browser until the person sends.

type Storage = BrowserApi['storage']['local']

// A draft belongs to one conversation, named by all three IDs, so switching shows that conversation's
// own draft and never carries one into another.
export type DraftTarget = { nodeId: string; taskId: string; sessionId: string }

// `captures` are page captures waiting to go with the next message. `pending` is a send the Node
// didn't confirm: the text and captures sent, and the key it went with. Sending that same text and
// those same captures again reuses the key, so the Node answers with the turn it may already have made.
export type Draft = {
  text: string
  captures?: PageCapture[]
  pending?: { key: string; text: string; captures?: string[] }
}

const draftKey = (target: DraftTarget) => `draft:${target.nodeId}:${target.taskId}:${target.sessionId}`
// Captures sit under their own key, because a screenshot can be megabytes and the text is saved on
// every keystroke.
const capturesKey = (target: DraftTarget) => `captures:${target.nodeId}:${target.taskId}:${target.sessionId}`

export async function loadDraft(storage: Storage, target: DraftTarget): Promise<Draft> {
  const stored = await storage.get([draftKey(target), capturesKey(target)])
  const draft = stored[draftKey(target)] as Omit<Draft, 'captures'> | undefined
  const captures = stored[capturesKey(target)] as PageCapture[] | undefined
  return {
    ...(typeof draft?.text === 'string' ? draft : { text: '' }),
    ...(Array.isArray(captures) && captures.length ? { captures } : {}),
  }
}

// Writes the captures only when they differ from `previous`. Rejects when browser storage is full; a
// screenshot is the only thing large enough to fill it.
export async function saveDraft(storage: Storage, target: DraftTarget, draft: Draft, previous?: Draft): Promise<void> {
  const { captures = [], ...rest } = draft
  if (!previous || draft.captures !== previous.captures) {
    if (captures.length) await storage.set({ [capturesKey(target)]: captures })
    else await storage.remove([capturesKey(target)])
  }
  if (!rest.text && !rest.pending) await storage.remove([draftKey(target)])
  else await storage.set({ [draftKey(target)]: rest })
}

// The captures a storage change stored for `target`, or undefined when it left them alone. The
// background stores one this way when the page's right-click menu adds a selection.
export function changedCaptures(
  target: DraftTarget,
  changes: Record<string, { newValue?: unknown }>,
): PageCapture[] | undefined {
  if (!(capturesKey(target) in changes)) return undefined
  const captures = changes[capturesKey(target)]?.newValue
  return Array.isArray(captures) ? (captures as PageCapture[]) : []
}

// Changes the stored draft of a conversation the sidebar no longer shows, for an operation that
// finished after the person moved on.
export async function changeDraft(storage: Storage, target: DraftTarget, change: (draft: Draft) => Draft) {
  const previous = await loadDraft(storage, target)
  await saveDraft(storage, target, change(previous), previous)
}

// The Node accepted a send of `text` with these captures. They leave the draft, and so does the text
// if it still reads the same; anything typed or captured since stays.
export const acknowledged =
  (text: string, captureIds: readonly string[]) =>
  (draft: Draft): Draft => ({
    text: draft.text.trim() === text ? '' : draft.text,
    ...(captureIds.length
      ? { captures: (draft.captures ?? []).filter((capture) => !captureIds.includes(capture.id)) }
      : draft.captures
        ? { captures: draft.captures }
        : {}),
  })

// An item waiting for a task's first conversation: a handed-off issue, or the page the task chip asked
// a new chat about. One per task, so it never joins a chat in another task, and kept in storage, so it
// outlives the panel. It joins the draft of the next conversation opened in its task.
const pendingItemKey = (nodeId: string, taskId: string) => `pendingItem:${nodeId}:${taskId}`

export async function loadPendingItem(storage: Storage, nodeId: string, taskId: string): Promise<PageCapture | null> {
  const stored = (await storage.get([pendingItemKey(nodeId, taskId)]))[pendingItemKey(nodeId, taskId)]
  return stored && typeof stored === 'object' ? (stored as PageCapture) : null
}

export const savePendingItem = (storage: Storage, nodeId: string, taskId: string, item: PageCapture): Promise<void> =>
  storage.set({ [pendingItemKey(nodeId, taskId)]: item })

export const dropPendingItems = (storage: Storage, nodeId: string, taskIds: readonly string[]): Promise<void> =>
  storage.remove(taskIds.map((taskId) => pendingItemKey(nodeId, taskId)))

// The task's item as a storage change left it, null when it went, or undefined when it wasn't touched.
export function changedPendingItem(
  nodeId: string,
  taskId: string,
  changes: Record<string, { newValue?: unknown }>,
): PageCapture | null | undefined {
  if (!(pendingItemKey(nodeId, taskId) in changes)) return undefined
  const item = changes[pendingItemKey(nodeId, taskId)]?.newValue
  return item && typeof item === 'object' ? (item as PageCapture) : null
}

// The task and conversation the sidebar last showed on a Node, which a selection added from the page's
// menu goes to.
export type Destination = { projectId: string | null; taskId: string | null; sessionId: string | null }

const destinationKey = (nodeId: string) => `destination:${nodeId}`

export async function loadDestination(storage: Storage, nodeId: string): Promise<Destination> {
  const stored = (await storage.get([destinationKey(nodeId)]))[destinationKey(nodeId)] as Destination | undefined
  return { projectId: stored?.projectId ?? null, taskId: stored?.taskId ?? null, sessionId: stored?.sessionId ?? null }
}

export const saveDestination = (storage: Storage, nodeId: string, destination: Destination): Promise<void> =>
  storage.set({ [destinationKey(nodeId)]: destination })

// A tab under a task. A plugin's panel is `panel:<pluginId>`.
export type TaskTab = 'agents' | 'runs' | `panel:${string}`
// What the sidebar remembers of a task: the tab the person last picked there, which the task opens on.
export type TaskView = { tab: TaskTab }

// The most tasks remembered on a Node. The oldest is forgotten first.
const TASK_VIEWS_MAX = 50
const taskViewsKey = (nodeId: string) => `taskViews:${nodeId}`

export async function loadTaskViews(storage: Storage, nodeId: string): Promise<Record<string, TaskView>> {
  const stored = (await storage.get([taskViewsKey(nodeId)]))[taskViewsKey(nodeId)]
  if (!stored || typeof stored !== 'object') return {}
  // Views stored by older builds name the Runs tab `workflows`.
  return Object.fromEntries(
    Object.entries(stored as Record<string, { tab: string }>).map(([taskId, view]) => [
      taskId,
      { tab: (view.tab === 'workflows' ? 'runs' : view.tab) as TaskTab },
    ]),
  )
}

// Keys keep insertion order, so the task saved last goes to the end and the first ones are the oldest.
export function rememberTaskView(
  views: Record<string, TaskView>,
  taskId: string,
  view: TaskView,
): Record<string, TaskView> {
  const { [taskId]: _replaced, ...rest } = views
  return Object.fromEntries([...Object.entries(rest), [taskId, view]].slice(-TASK_VIEWS_MAX))
}

export const saveTaskViews = (storage: Storage, nodeId: string, views: Record<string, TaskView>): Promise<void> =>
  storage.set({ [taskViewsKey(nodeId)]: views })

// The workspace whose tasks Home lists, as the person last chose it on each Node.
const homeWorkspaceKey = (nodeId: string) => `homeWorkspace:${nodeId}`

export async function loadHomeWorkspace(storage: Storage, nodeId: string): Promise<string | null> {
  const stored = (await storage.get([homeWorkspaceKey(nodeId)]))[homeWorkspaceKey(nodeId)]
  return typeof stored === 'string' ? stored : null
}

export const saveHomeWorkspace = (storage: Storage, nodeId: string, workspaceId: string): Promise<void> =>
  storage.set({ [homeWorkspaceKey(nodeId)]: workspaceId })
