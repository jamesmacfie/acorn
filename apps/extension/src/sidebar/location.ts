import { createSignal } from 'solid-js'
import type { BrowserApi } from '../browser'
import {
  loadDestination,
  loadTaskViews,
  rememberTaskView,
  saveDestination,
  saveTaskViews,
  type TaskTab,
  type TaskView,
} from '../localState'

// Where the sidebar is: Home, one task on one of its tabs, one conversation inside a task, or Settings.
// The task is the subject of everything under the top bar, and nothing else is.
// docs/browser-extension/navigation.md.
export type Location =
  | { level: 'home' }
  | { level: 'task'; taskId: string; tab: TaskTab }
  // `from` is the tab Back returns to: Runs for a workflow step's conversation, Agents otherwise.
  | { level: 'conversation'; taskId: string; sessionId: string; from: 'agents' | 'runs' }
  | { level: 'settings' }

export type Navigation = ReturnType<typeof createLocation>

// The task a location shows, if any.
export const locationTask = (location: Location): string | null =>
  location.level === 'task' || location.level === 'conversation' ? location.taskId : null

// The sidebar's one location and the moves between levels. Each move sets a new object, so a caller
// that awaited something can compare `location()` with what it saw first to learn whether the person
// moved meanwhile. The selected Node's last task or conversation and the tab last picked in each of
// its tasks are kept in browser storage.
export function createLocation(options: {
  storage: BrowserApi['storage']['local']
  // The task the page beside the panel belongs to, and the Node's active tasks, null until read.
  pageTaskId(): string | null
  tasks(): readonly { id: string; projectId: string }[] | null
}) {
  const { storage, pageTaskId, tasks } = options
  const projectOf = (taskId: string) => tasks()?.find((task) => task.id === taskId)?.projectId ?? null
  const [location, setLocation] = createSignal<Location>({ level: 'home' })
  let nodeId: string | null = null
  let taskViews: Record<string, TaskView> = {}
  // While a Node's stored location loads, which follows the page itself once it has.
  let restoring = false
  // The task the stored location named, until the Node's task list says whether it's still active.
  let restored: string | null = null

  // Home and Settings leave the stored destination alone, so a selection added from the page's menu
  // still has a conversation to go to.
  const go = (next: Location) => {
    setLocation(next)
    const taskId = locationTask(next)
    if (!nodeId || !taskId) return
    // A step's conversation needs its run to show, so its task stands in for it.
    const sessionId = next.level === 'conversation' && next.from === 'agents' ? next.sessionId : null
    void saveDestination(storage, nodeId, { projectId: projectOf(taskId), taskId, sessionId })
    const view = taskViews[taskId]
    if ((view?.sessionId ?? null) === sessionId) return
    taskViews = rememberTaskView(taskViews, taskId, { tab: view?.tab ?? 'agents', ...(sessionId && { sessionId }) })
    void saveTaskViews(storage, nodeId, taskViews)
  }

  const taskAt = (taskId: string, tab?: TaskTab): Location => ({
    level: 'task',
    taskId,
    tab: tab ?? taskViews[taskId]?.tab ?? 'agents',
  })
  const openTask = (taskId: string, tab?: TaskTab) => go(taskAt(taskId, tab))
  const openConversation = (taskId: string, sessionId: string, from: 'agents' | 'runs' = 'agents') =>
    go({ level: 'conversation', taskId, sessionId, from })
  const goHome = () => go({ level: 'home' })

  // The page beside the panel moved, or the Node's task list arrived. A stored task the list doesn't
  // have, archived while the panel was closed, gives way to Home. A page of a task opens that task, on
  // the conversation it last showed or else its tab, unless Settings or a conversation is open. Moving
  // to a page of no task sends a task or conversation Home, so the panel doesn't keep showing a task
  // the page has nothing to do with. Opening the panel beside one keeps where it last was.
  const followPage = (taskId: string | null, moved = false) => {
    if (restoring) return
    const list = tasks()
    if (restored && list) {
      if (locationTask(location()) === restored && !list.some((task) => task.id === restored)) goHome()
      restored = null
    }
    const here = location()
    if (here.level === 'settings') return
    if (!taskId) {
      // Until the list arrives every page looks taskless, so nothing moves.
      if (moved && list && locationTask(here)) goHome()
    } else if (here.level === 'home' || (here.level === 'task' && here.taskId !== taskId)) {
      const sessionId = taskViews[taskId]?.sessionId
      if (sessionId) openConversation(taskId, sessionId)
      else openTask(taskId)
    }
  }

  return {
    location,
    openTask,
    openConversation,
    goHome,
    followPage,
    openSettings: () => go({ level: 'settings' }),

    // The person picked one of the task's tabs, from the task or a conversation in it. The task opens
    // on that tab next time.
    pickTab(tab: TaskTab) {
      const here = location()
      if ((here.level !== 'task' && here.level !== 'conversation') || !nodeId) return
      taskViews = rememberTaskView(taskViews, here.taskId, { tab })
      void saveTaskViews(storage, nodeId, taskViews)
      go(taskAt(here.taskId, tab))
    },

    // Up one level: a conversation to the tab it came from, a task or Settings to Home.
    back() {
      const here = location()
      if (here.level === 'conversation') openTask(here.taskId, here.from)
      else goHome()
    },

    // Another Node was selected, or none. Settings stays open; anywhere else, the sidebar starts Home,
    // then returns to where it last was on that Node and follows the page from there, unless something
    // moved it while storage answered.
    async selectNode(next: string | null) {
      nodeId = next
      taskViews = {}
      restored = null
      const started: Location = location().level === 'settings' ? location() : { level: 'home' }
      setLocation(started)
      restoring = next !== null
      if (!next) return
      const [views, destination] = await Promise.all([loadTaskViews(storage, next), loadDestination(storage, next)])
      if (nodeId !== next) return
      restoring = false
      taskViews = { ...views, ...taskViews }
      if (location() !== started || started.level === 'settings') return
      // Not through `go`: the destination is already stored, with a project the task list may not know yet.
      const { taskId, sessionId } = destination
      restored = taskId
      if (taskId) setLocation(sessionId ? { level: 'conversation', taskId, sessionId, from: 'agents' } : taskAt(taskId))
      followPage(pageTaskId())
    },
  }
}
