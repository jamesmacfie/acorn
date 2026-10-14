import { createSignal, onCleanup, type Accessor } from 'solid-js'
import type { BridgeTaskPage } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi, Tab } from '../browser'
import { pageMatches } from '../taskPages'

// Every tab open in the browser, read again as tabs navigate and close, so Home can say which of a
// task's links are already open. The `tabs` permission gives every tab's address. Call inside a
// component, which owns the listeners.
export function openTabs(api: BrowserApi): Accessor<Tab[]> {
  const [tabs, setTabs] = createSignal<Tab[]>([])
  const read = async () => setTabs(await api.tabs.query({}))
  // A new tab reports its address here once it has one.
  const onUpdated = (_tabId: number, change: { url?: string }) => {
    if (change.url !== undefined) void read()
  }
  const onRemoved = () => void read()

  void read()
  api.tabs.onUpdated.addListener(onUpdated)
  api.tabs.onRemoved.addListener(onRemoved)
  onCleanup(() => {
    api.tabs.onUpdated.removeListener(onUpdated)
    api.tabs.onRemoved.removeListener(onRemoved)
  })
  return tabs
}

// The open tab showing a task's link, by the same rule that matches a page to its task.
export const tabFor = (tabs: readonly Tab[], page: BridgeTaskPage): Tab | undefined =>
  tabs.find((tab) => tab.id !== undefined && tab.url !== undefined && pageMatches(page, tab.url))

// Brings the link's tab forward, its window too, or opens the link in a new tab.
export async function showPage(api: BrowserApi, tabs: readonly Tab[], page: BridgeTaskPage): Promise<void> {
  const tab = tabFor(tabs, page)
  if (!tab) {
    await api.tabs.create({ url: `${page.origin}${page.pathPrefix}` })
    return
  }
  await api.tabs.update(tab.id!, { active: true })
  await api.windows.update(tab.windowId, { focused: true })
}
