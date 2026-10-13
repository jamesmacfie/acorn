import type { BridgeHandoff } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi, MessageSender, Tab } from '../browser'
import {
  HIDDEN_MARKERS_KEY,
  handoffKey,
  pageHandoffs,
  type AppMarker,
  type ButtonClick,
  type ChipTask,
  type ContentMessage,
  type PageHandoff,
} from '../handoffs'

// The selected Node's handoffs, kept in browser storage so a page gets its buttons as it loads, before
// the native host has started. docs/browser-extension/handoffs.md.
export const HANDOFFS_KEY = 'handoffs'
type Cached = { nodeId: string | null; handoffs: BridgeHandoff[] }

// Which pages get which buttons. A page gets the content script only when the extension may read it:
// a site the person granted, or the tab the toolbar button was clicked on. A tab that loses its match,
// its access, or its Node is told to draw nothing. On a page that belongs to a task, the button is the
// task chip. A page on an app a plugin published for a task gets the branch marker, unless the person
// hid it on that origin.
export function siteButtons(
  api: BrowserApi,
  events: {
    // A button was clicked: open the panel. Called inside the click's message handler, where the
    // browser still counts the person's gesture.
    open(tab: Tab): void
    clicked(handoff: PageHandoff): void
    // A task chip was clicked: show the page's task, with a new chat about the page for `chat`.
    showTask(chat: { url: string; title: string } | null): void
    // The task a page belongs to, as its chip draws it.
    chip(url: string): { taskId: string; chip: ChipTask } | null
    // The task whose app a plugin published at the page's origin, as the branch marker draws it.
    marker(url: string): AppMarker | null
    // The tasks the chips on open pages show, so their agents are kept current.
    follow(taskIds: ReadonlySet<string>): void
    opensLinks: boolean
  },
) {
  let cached: Cached = { nodeId: null, handoffs: [] }
  let hidden = new Set<string>()
  // Tabs told to draw at least one button, so they can be told to stop, with the task each one's
  // chip shows.
  const drawing = new Map<number, string | null>()
  const follow = () => events.follow(new Set([...drawing.values()].filter((taskId) => taskId !== null)))

  const send = (tabId: number, buttons: ContentMessage['buttons'], marker: AppMarker | null): Promise<unknown> =>
    api.tabs
      .sendMessage(tabId, {
        type: 'acorn:buttons',
        buttons,
        marker,
        opensLinks: events.opensLinks,
        opensPanel: !!api.sidePanel,
      } satisfies ContentMessage)
      .catch(() => undefined)

  const markerFor = (url: string | undefined): AppMarker | null => {
    const marker = url ? events.marker(url) : null
    return marker && !hidden.has(new URL(url!).origin) ? marker : null
  }

  async function drawTab(tabId: number, url: string | undefined): Promise<void> {
    const handoffs = pageHandoffs(cached.handoffs, url)
    const marker = markerFor(url)
    if (!handoffs.length && !marker) {
      if (drawing.delete(tabId)) await send(tabId, [], null)
      return
    }
    // A page with only a marker draws no chip, so its task's agents needn't be followed.
    const task = handoffs.length ? events.chip(url!) : null
    try {
      await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    } catch {
      // No access to this page after all. The sidebar still offers the handoff.
      return
    }
    drawing.set(tabId, task?.taskId ?? null)
    await send(
      tabId,
      handoffs.map((handoff) => ({
        key: handoffKey(handoff),
        label: handoff.label,
        anchors: handoff.anchors,
        task: task?.chip ?? null,
      })),
      marker,
    )
  }

  async function syncTab(tabId: number, url: string | undefined): Promise<void> {
    await drawTab(tabId, url)
    follow()
  }

  async function syncAll(): Promise<void> {
    const tabs = await api.tabs.query({})
    const open = new Set<number>()
    for (const tab of tabs) {
      if (tab.id === undefined) continue
      open.add(tab.id)
      await drawTab(tab.id, tab.url)
    }
    for (const tabId of drawing.keys()) if (!open.has(tabId)) drawing.delete(tabId)
    follow()
  }

  const hiddenFrom = (value: unknown) => new Set(Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [])
  const restored = api.storage.local.get([HANDOFFS_KEY, HIDDEN_MARKERS_KEY]).then((stored) => {
    const value = stored[HANDOFFS_KEY] as Cached | undefined
    if (value && Array.isArray(value.handoffs)) cached = value
    hidden = hiddenFrom(stored[HIDDEN_MARKERS_KEY])
    return syncAll()
  })
  // The marker's menu hides it here, and the sidebar shows it again.
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(HIDDEN_MARKERS_KEY in changes)) return
    hidden = hiddenFrom(changes[HIDDEN_MARKERS_KEY]?.newValue)
    void syncAll()
  })

  api.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.url !== undefined || change.status === 'complete') void syncTab(tabId, tab.url)
  })
  // A new grant can show buttons; a removed one must take them away from pages already open.
  api.permissions.onAdded.addListener(() => void syncAll())
  api.permissions.onRemoved.addListener(() => void syncAll())

  api.runtime.onMessage.addListener((raw, sender: MessageSender) => {
    const message = raw as ButtonClick | null
    if (!message || !sender.tab || sender.frameId !== 0 || !sender.url) return
    // The browser's record of the page address again, and only a page that still has a marker.
    if (message.type === 'acorn:marker') {
      if (!markerFor(sender.url)) return
      if (message.action === 'hide')
        void api.storage.local.set({ [HIDDEN_MARKERS_KEY]: [...hidden, new URL(sender.url).origin] })
      else {
        events.open(sender.tab)
        events.showTask(null)
      }
      return
    }
    const handoff = cached.handoffs.find((entry) => handoffKey(entry) === message.key)
    // The browser's record of the page address, not anything the page said, and only a page the
    // handoff still matches.
    if (!handoff || !pageHandoffs([handoff], sender.url).length) return
    if (message.type === 'acorn:handoff') {
      events.open(sender.tab)
      events.clicked({ pluginId: handoff.pluginId, handoffId: handoff.id, label: handoff.label, url: sender.url })
    } else if (message.type === 'acorn:chip' && events.chip(sender.url)) {
      events.open(sender.tab)
      events.showTask(message.action === 'chat' ? { url: sender.url, title: sender.tab.title ?? sender.url } : null)
    }
  })

  return {
    restored,
    // The selection moved: the old Node's buttons go at once, and the new Node's arrive with its list.
    async select(nodeId: string | null): Promise<void> {
      if (cached.nodeId === nodeId) return
      await this.update({ nodeId, handoffs: [] })
    },
    async update(next: Cached): Promise<void> {
      cached = next
      if (next.nodeId) await api.storage.local.set({ [HANDOFFS_KEY]: next })
      else await api.storage.local.remove([HANDOFFS_KEY])
      await syncAll()
    },
    get nodeId() {
      return cached.nodeId
    },
    // The toolbar button grants access to this one tab, so it can get its buttons now.
    syncTab,
    // What a chip shows changed: its task, or that task's agents.
    redraw: syncAll,
  }
}
