import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type {
  BridgeAgentHint,
  BridgeAgentSession,
  BridgeOperation,
  BridgePageTask,
  BridgePendingRequest,
  BridgeResults,
} from '@acorn/protocol/extensionBridge.ts'
import { itemTaskLink } from '../acornLinks'
import type { AppMarker, ChipTask } from '../handoffs'
import type { BackgroundMessage, BridgeCall } from '../messages'
import type { PageTask } from '../taskPages'

// What the chip on a page shows for its task: the name, a link to it, and how many agents wait on the
// person or, when none does, how many are working. A conversation is waiting while the Node holds a
// request from it, as the sidebar counts it.
export function chipTask(
  nodeId: string,
  { task, page }: PageTask,
  sessions: readonly BridgeAgentSession[] | undefined,
  requests: readonly BridgePendingRequest[],
): ChipTask {
  const waiting = new Set(requests.filter((request) => request.taskId === task.id).map((request) => request.sessionId))
  const working = (sessions ?? []).filter(
    (session) => session.runtimeState === 'working' && !waiting.has(session.id),
  ).length
  return {
    title: task.title,
    state: waiting.size
      ? { label: `${waiting.size} waiting`, tone: 'warn' }
      : working
        ? { label: `${working} working`, tone: 'ok' }
        : null,
    link: itemTaskLink(nodeId, page.source, task.id),
  }
}

// What the branch marker on a plugin's app shows: the task's branch, or its name for a task on the
// project's own checkout, the state the plugin gave, and a link to the plugin's pane on the task.
export const appMarker = (nodeId: string, { task, page }: PageTask): AppMarker | null =>
  page.status
    ? {
        branch: task.branch ?? task.title,
        state: { label: page.status.state, tone: page.status.tone },
        link: itemTaskLink(nodeId, page.source, task.id),
      }
    : null

// The selected Node's tasks and the page addresses each is known by, the one copy the extension
// keeps (docs/browser-extension/task-pages.md). The sidebar and the task chips match pages against it in
// the browser. It is read again on a selection, a return of the connection, a dropped-frames hint,
// and each task or project change the bridge reports, never on a timer.
//
// It also keeps the conversations of the tasks open pages belong to, which their chips count. Those
// are read when a page first shows the task, and again when a hint names the task or one of them.
export function taskPages(deps: {
  read<Op extends BridgeOperation>(call: Extract<BridgeCall, { op: Op }>): Promise<BridgeResults[Op]>
  broadcast(message: BackgroundMessage): void
  // What a chip draws may have changed.
  changed(): void
}) {
  let nodeId: string | null = null
  let up = false
  let tasks: BridgePageTask[] = []
  // The conversations of each followed task: absent until read.
  let sessions = new Map<string, BridgeAgentSession[]>()
  let followed = new Set<string>()

  const show = (next: BridgePageTask[]): void => {
    tasks = next
    deps.broadcast({ type: 'taskPages', nodeId, tasks })
    deps.changed()
  }

  // At most one read in flight. A change that arrives meanwhile reads once more after it.
  let reading: Promise<void> | null = null
  let again = false
  const readTasks = (): Promise<void> => {
    if (reading) {
      again = true
      return reading
    }
    reading = (async () => {
      do {
        again = false
        const forNode = nodeId
        if (!forNode) return
        try {
          const result = await deps.read({ op: 'tasks.pages', nodeId: forNode })
          if (result.nodeId === nodeId) show(result.tasks)
        } catch {
          // The last list stands; the next change or reconnect reads it again.
        }
      } while (again)
    })().finally(() => (reading = null))
    return reading
  }

  const working = (list: readonly BridgeAgentSession[] | undefined) =>
    list
      ?.filter((session) => session.runtimeState === 'working')
      .map((session) => session.id)
      .join()
  const readSessions = async (taskId: string): Promise<void> => {
    const forNode = nodeId
    if (!forNode) return
    try {
      const result = await deps.read({ op: 'sessions.list', nodeId: forNode, taskId })
      if (forNode !== nodeId || !followed.has(taskId)) return
      const before = working(sessions.get(taskId))
      sessions.set(taskId, result.sessions)
      if (working(result.sessions) !== before) deps.changed()
    } catch {
      // The chip keeps its last count, and the next hint for the task reads again.
    }
  }

  return {
    async select(next: string | null): Promise<void> {
      if (next === nodeId) return
      nodeId = next
      sessions = new Map()
      followed = new Set()
      show([])
      if (next && up) await readTasks()
    },
    status(status: NodeStatus): void {
      const wasUp = up
      up = status.state === 'online' || status.state === 'degraded'
      if (status.nodeId !== nodeId || !up || wasUp) return
      // Frames missed while it was away are never replayed, so a return means read again.
      void readTasks()
      for (const taskId of followed) void readSessions(taskId)
    },
    hostDown(): void {
      up = false
    },
    hint(hint: BridgeAgentHint): void {
      if (hint.nodeId !== nodeId) return
      if (hint.missed) void readTasks()
      for (const taskId of followed) {
        const known = sessions.get(taskId) ?? []
        if (hint.missed || hint.tasks.includes(taskId) || known.some((session) => hint.sessions.includes(session.id)))
          void readSessions(taskId)
      }
    },
    // A task or project changed on the Node: an address may have come or gone with it.
    changedOn(changed: string): void {
      if (changed === nodeId) void readTasks()
    },
    get tasks(): readonly BridgePageTask[] {
      return tasks
    },
    // The tasks open pages belong to now. A task new to the set has its conversations read.
    follow(taskIds: ReadonlySet<string>): void {
      for (const taskId of taskIds) if (!followed.has(taskId)) void readSessions(taskId)
      for (const taskId of sessions.keys()) if (!taskIds.has(taskId)) sessions.delete(taskId)
      followed = new Set(taskIds)
    },
    // The task's conversations, or undefined until they are read.
    sessions: (taskId: string): readonly BridgeAgentSession[] | undefined => sessions.get(taskId),
    // What a sidebar that connects now should show.
    get current(): Extract<BackgroundMessage, { type: 'taskPages' }> {
      return { type: 'taskPages', nodeId, tasks }
    },
  }
}
