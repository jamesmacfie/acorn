import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type {
  BridgeAgentHint,
  BridgeOperation,
  BridgePendingRequest,
  BridgeResults,
} from '@acorn/protocol/extensionBridge.ts'
import type { ProjectSite } from '@acorn/protocol/siteAssociations.ts'
import type { BrowserApi } from '../browser'
import type { BackgroundMessage, BridgeCall, RequestTarget } from '../messages'
import { loadSiteChoices, pageScope, siteChoicesKey, type SiteChoices } from '../pageScope'

// Which requests have had an OS notification, so a restart of the background or the host doesn't
// deliver one twice. docs/browser-extension/notifications.md.
export const NOTIFIED_KEY = 'notifiedRequests'
type Notified = { nodeId: string; ids: string[] }

const NOTIFICATIONS = { permissions: ['notifications'] }
const requestKey = (request: Pick<BridgePendingRequest, 'sessionId' | 'requestId'>) =>
  `${request.sessionId}:${request.requestId}`
const notificationId = (key: string) => `acorn-request:${key}`

// Generic on purpose: an OS notification can show on a locked screen, so it says what kind of thing is
// waiting and nothing the agent wrote.
const notificationText = (kind: string): string =>
  kind === 'permission' ? 'An agent is asking for permission.' : 'An agent has a question for you.'

// The requests agents are waiting on for each tab's projects and tasks, shown on the toolbar badge, and
// as an OS notification when the person has allowed them. The open requests come from the selected
// Node; which of them belong to a tab is decided here, from the page's address, the cached
// associations, the person's choices, and the tasks the page belongs to, so no page address goes to
// the Node. The list is read again on every request
// change, a dropped-frames hint, and each return of the connection, and dropped whenever the
// connection is down, so a count is never older than the Node's own state.
export function requestBadge(
  api: BrowserApi,
  deps: {
    read<Op extends BridgeOperation>(call: Extract<BridgeCall, { op: Op }>): Promise<BridgeResults[Op]>
    broadcast(message: BackgroundMessage): void
    // An OS notification was clicked: show its conversation.
    open(target: RequestTarget): void
    // The tasks a page belongs to, from the list the Node sent.
    pageTaskIds(url: string): string[]
  },
) {
  let nodeId: string | null = null
  let up = false
  // Null while unknown: before the first read, after a failed one, and while the connection is down.
  let pending: BridgePendingRequest[] | null = null
  let sites: ProjectSite[] = []
  let visible = new Set<string>()
  let choices: SiteChoices = {}

  const scoped = (url: string | undefined): BridgePendingRequest[] => {
    if (!pending || !url) return []
    const projects = pageScope(sites, visible, choices, url).projects
    const tasks = deps.pageTaskIds(url)
    return pending.filter((request) => projects.includes(request.projectId) || tasks.includes(request.taskId))
  }

  const drawTab = (tabId: number, url: string | undefined): Promise<void> => {
    const count = scoped(url).length
    return api.action.setBadgeText({ tabId, text: count ? String(count) : '' }).catch(() => undefined)
  }
  const draw = async (): Promise<void> => {
    for (const tab of await api.tabs.query({})) if (tab.id !== undefined) await drawTab(tab.id, tab.url)
  }

  // One delivery pass at a time, so two can't both decide a request is new.
  let delivering: Promise<void> = Promise.resolve()
  const deliver = (): Promise<void> => (delivering = delivering.then(deliverOnce, deliverOnce))
  async function deliverOnce(): Promise<void> {
    if (!nodeId || !pending) return
    const forNode = nodeId
    const stored = (await api.storage.local.get([NOTIFIED_KEY]))[NOTIFIED_KEY] as Notified | undefined
    const before = stored?.nodeId === forNode ? stored.ids : []
    // Another Node's notifications go with its selection.
    if (stored && stored.nodeId !== forNode) for (const key of stored.ids) void clear(key)
    const waiting = new Set(pending.map(requestKey))
    const delivered = new Set(before.filter((key) => waiting.has(key)))
    for (const key of before) if (!waiting.has(key)) void clear(key)
    if (api.notifications && (await api.permissions.contains(NOTIFICATIONS))) {
      // The sites the person has in front of them: each window's active tab. Filtered here, because
      // Firefox 151 has answered an `active` query without the address it reports for the same tab.
      const active = (await api.tabs.query({})).filter((tab) => tab.active)
      for (const request of active.flatMap((tab) => scoped(tab.url))) {
        const key = requestKey(request)
        if (delivered.has(key)) continue
        delivered.add(key)
        await api.notifications
          .create(notificationId(key), {
            type: 'basic',
            iconUrl: api.runtime.getURL('icon-128.png'),
            title: 'Acorn',
            message: `${notificationText(request.kind)} Open Acorn to answer.`,
          })
          .catch(() => undefined)
      }
    }
    const ids = [...delivered]
    if (nodeId !== forNode) return
    if (!ids.length) {
      if (stored) await api.storage.local.remove([NOTIFIED_KEY])
    } else if (stored?.nodeId !== forNode || ids.join() !== before.join())
      await api.storage.local.set({ [NOTIFIED_KEY]: { nodeId: forNode, ids } satisfies Notified })
  }
  const clear = (key: string) => api.notifications?.clear(notificationId(key)).catch(() => false)

  const show = (next: BridgePendingRequest[] | null): void => {
    pending = next
    deps.broadcast({ type: 'requests', nodeId, requests: next ?? [] })
    void draw()
    void deliver()
  }

  // At most one read in flight. A hint that arrives meanwhile reads once more after it.
  let reading: Promise<void> | null = null
  let again = false
  const readPending = (): Promise<void> => {
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
          const result = await deps.read({ op: 'requests.pending', nodeId: forNode })
          if (result.nodeId === nodeId) show(result.requests)
        } catch {
          if (forNode === nodeId) show(null)
        }
      } while (again)
    })().finally(() => (reading = null))
    return reading
  }

  // The visible projects and their associations, which say which requests belong to a page.
  const readScope = async (): Promise<void> => {
    const forNode = nodeId
    if (!forNode) return
    try {
      const [projects, listed] = await Promise.all([
        deps.read({ op: 'projects.list', nodeId: forNode }),
        deps.read({ op: 'sites.list', nodeId: forNode }),
      ])
      if (forNode !== nodeId) return
      visible = new Set(projects.projects.filter((project) => !project.hidden).map((project) => project.id))
      sites = listed.sites
      void draw()
      void deliver()
    } catch {
      // The last scope stands; the next project change or reconnect reads it again.
    }
  }

  const reload = async (): Promise<void> => {
    const forNode = nodeId
    if (!forNode) return
    const loaded = await loadSiteChoices(api.storage.local, forNode)
    if (forNode !== nodeId) return
    choices = loaded
    await Promise.all([readScope(), readPending()])
  }

  api.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.url !== undefined || change.status === 'complete') void drawTab(tabId, tab.url)
    if (tab.active) void deliver()
  })
  api.tabs.onActivated.addListener(() => void deliver())
  // A site grant or removal changes which pages report an address; the notifications permission is the
  // person's opt-in, and taking it away stops delivery.
  const accessChanged = () => {
    listenForClicks()
    void draw()
    void deliver()
  }
  api.permissions.onAdded.addListener(accessChanged)
  api.permissions.onRemoved.addListener(accessChanged)
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !nodeId || !(siteChoicesKey(nodeId) in changes)) return
    const next = changes[siteChoicesKey(nodeId)]?.newValue
    choices = next && typeof next === 'object' ? (next as SiteChoices) : {}
    void draw()
    void deliver()
  })

  // The notifications API appears only once its permission is granted.
  let listening = false
  function listenForClicks(): void {
    if (listening || !api.notifications) return
    listening = true
    api.notifications.onClicked.addListener((id) => {
      const request = pending?.find((candidate) => notificationId(requestKey(candidate)) === id)
      void api.notifications?.clear(id).catch(() => false)
      if (!request || !nodeId) return
      deps.open({ nodeId, projectId: request.projectId, taskId: request.taskId, sessionId: request.sessionId })
    })
  }
  listenForClicks()
  void api.action.setBadgeBackgroundColor({ color: '#b45309' }).catch(() => undefined)

  return {
    // The selected Node changed. Its old requests, scope, and choices go at once.
    async select(next: string | null): Promise<void> {
      if (next === nodeId) return
      nodeId = next
      sites = []
      visible = new Set()
      choices = {}
      show(null)
      if (next && up) await reload()
    },
    status(status: NodeStatus): void {
      const wasUp = up
      up = status.state === 'online' || status.state === 'degraded'
      if (status.nodeId !== nodeId) return
      // Frames missed while it was away are never replayed, so a return means read again.
      if (up && !wasUp) void reload()
      else if (!up && wasUp) show(null)
    },
    // The native host stopped: nothing it reported can be trusted until it is back.
    hostDown(): void {
      up = false
      if (pending) show(null)
    },
    hint(hint: BridgeAgentHint): void {
      if (hint.nodeId !== nodeId) return
      const touchesWaiting = pending?.some((request) => hint.sessions.includes(request.sessionId))
      if (hint.requests || hint.missed || touchesWaiting) void readPending()
    },
    projectsChanged(changed: string): void {
      if (changed === nodeId) void readScope()
    },
    // The Node's tasks or their addresses changed, which can move a request onto or off a page.
    tasksChanged(): void {
      void draw()
      void deliver()
    },
    // The toolbar button granted this tab, which the browser reports with no tab or permission event.
    tabGranted(tabId: number, url: string | undefined): void {
      void drawTab(tabId, url)
      void deliver()
    },
    // What a sidebar that connects now should show.
    get current(): Extract<BackgroundMessage, { type: 'requests' }> {
      return { type: 'requests', nodeId, requests: pending ?? [] }
    },
  }
}
