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
  // The task the page beside the panel belongs to, and an active task's project.
  pageTaskId(): string | null
  projectOf(taskId: string): string | null
}) {
  const { storage, pageTaskId, projectOf } = options
  const [location, setLocation] = createSignal<Location>({ level: 'home' })
  let nodeId: string | null = null
  let taskViews: Record<string, TaskView> = {}
  // While a Node's stored location loads, which follows the page itself once it has.
  let restoring = false

  // Home and Settings leave the stored destination alone, so a selection added from the page's menu
  // still has a conversation to go to.
  const go = (next: Location) => {
    setLocation(next)
    const taskId = locationTask(next)
    if (!nodeId || !taskId) return
    // A step's conversation needs its run to show, so its task stands in for it.
    const sessionId = next.level === 'conversation' && next.from === 'agents' ? next.sessionId : null
    void saveDestination(storage, nodeId, { projectId: projectOf(taskId), taskId, sessionId })
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

  // The page beside the panel moved, or the Node's task list arrived. A page of a task opens that task,
  // unless Settings or a conversation is open: pages are often visited to capture them into the
  // conversation. A page of no task leaves the panel where it is.
  const followPage = (taskId: string | null) => {
    const here = location()
    if (restoring || !taskId || here.level === 'settings' || here.level === 'conversation') return
    if (here.level !== 'task' || here.taskId !== taskId) openTask(taskId)
  }

  return {
    location,
    openTask,
    openConversation,
    goHome,
    followPage,
    openSettings: () => go({ level: 'settings' }),

    // The person picked a tab under the task, which the task opens on next time.
    pickTab(tab: TaskTab) {
      const here = location()
      if (here.level !== 'task' || !nodeId) return
      taskViews = rememberTaskView(taskViews, here.taskId, { tab })
      void saveTaskViews(storage, nodeId, taskViews)
      go({ ...here, tab })
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
      if (taskId) setLocation(sessionId ? { level: 'conversation', taskId, sessionId, from: 'agents' } : taskAt(taskId))
      followPage(pageTaskId())
    },
  }
}
