import type { BridgeHandoff } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi, MessageSender, Tab } from '../browser'
import { handoffKey, pageHandoffs, type ButtonClick, type ContentMessage, type PageHandoff } from '../handoffs'

// The selected Node's handoffs, kept in browser storage so a page gets its buttons as it loads, before
// the native host has started. docs/browser-extension/handoffs.md.
export const HANDOFFS_KEY = 'handoffs'
type Cached = { nodeId: string | null; handoffs: BridgeHandoff[] }

// Which pages get which buttons. A page gets the content script only when the extension may read it:
// a site the person granted, or the tab the toolbar button was clicked on. A tab that loses its match,
// its access, or its Node is told to draw nothing.
export function siteButtons(
  api: BrowserApi,
  events: {
    // A button was clicked: open the panel. Called inside the click's message handler, where the
    // browser still counts the person's gesture.
    open(tab: Tab): void
    clicked(handoff: PageHandoff): void
  },
) {
  let cached: Cached = { nodeId: null, handoffs: [] }
  // Tabs told to draw at least one button, so they can be told to stop.
  const drawing = new Set<number>()

  const send = (tabId: number, buttons: ContentMessage['buttons']): Promise<unknown> =>
    api.tabs.sendMessage(tabId, { type: 'acorn:buttons', buttons } satisfies ContentMessage).catch(() => undefined)

  async function syncTab(tabId: number, url: string | undefined): Promise<void> {
    const buttons = pageHandoffs(cached.handoffs, url).map((handoff) => ({
      key: handoffKey(handoff),
      label: handoff.label,
      anchors: handoff.anchors,
    }))
    if (!buttons.length) {
      if (drawing.delete(tabId)) await send(tabId, [])
      return
    }
    try {
      await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    } catch {
      // No access to this page after all. The sidebar still offers the handoff.
      return
    }
    drawing.add(tabId)
    await send(tabId, buttons)
  }

  async function syncAll(): Promise<void> {
    const tabs = await api.tabs.query({})
    const open = new Set<number>()
    for (const tab of tabs) {
      if (tab.id === undefined) continue
      open.add(tab.id)
      await syncTab(tab.id, tab.url)
    }
    for (const tabId of drawing) if (!open.has(tabId)) drawing.delete(tabId)
  }

  const restored = api.storage.local.get([HANDOFFS_KEY]).then((stored) => {
    const value = stored[HANDOFFS_KEY] as Cached | undefined
    if (value && Array.isArray(value.handoffs)) cached = value
    return syncAll()
  })

  api.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.url !== undefined || change.status === 'complete') void syncTab(tabId, tab.url)
  })
  // A new grant can show buttons; a removed one must take them away from pages already open.
  api.permissions.onAdded.addListener(() => void syncAll())
  api.permissions.onRemoved.addListener(() => void syncAll())

  api.runtime.onMessage.addListener((raw, sender: MessageSender) => {
    const message = raw as ButtonClick | null
    if (message?.type !== 'acorn:handoff' || !sender.tab || sender.frameId !== 0 || !sender.url) return
    const handoff = cached.handoffs.find((entry) => handoffKey(entry) === message.key)
    // The browser's record of the page address, not anything the page said, and only a page the
    // handoff still matches.
    if (!handoff || !pageHandoffs([handoff], sender.url).length) return
    events.open(sender.tab)
    events.clicked({ pluginId: handoff.pluginId, handoffId: handoff.id, label: handoff.label, url: sender.url })
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
  }
}
