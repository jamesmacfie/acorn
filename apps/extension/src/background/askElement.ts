import type { BrowserApi, Tab } from '../browser'
import type { PickerMessage } from '../handoffs'

const MENU_ID = 'ask-acorn-about-element'

// Ask Acorn about this element, on a right-click anywhere on a page. Like Add to Acorn chat, the entry
// is always on the menu. On a page that belongs to a task, a click starts the element picker in the
// page. When the picker script was already there, it saw the right-click and picks that element;
// otherwise it's injected now and the person points at the element. When the page can't have the
// picker, the panel opens and says why in one line.
export function askElement(
  api: BrowserApi,
  events: {
    // Called inside the click, where the browser still counts the person's gesture.
    open(tab: Tab): void
    selectedNode(): string | null
    // Whether the page belongs to one of the selected Node's tasks.
    onTaskPage(url: string | undefined): boolean
    // Why nothing was picked, in one line.
    refused(notice: string): void
  },
): void {
  // From what the background holds now, so the panel can open inside the click. A background that has
  // only just started may not have the Node's tasks yet, but it runs as long as a Node's host is
  // connected, and without one nothing can be asked.
  const refusal = (frameId: number | undefined, url: string | undefined): string | null => {
    if (!events.selectedNode())
      return 'No Node is selected, so there is no agent to ask. Choose or pair a Node, then try again.'
    if (!events.onTaskPage(url))
      return "This page doesn't belong to a task, so there is no agent to ask about it. Open a task's pull request, issue, or app, then try again."
    if (frameId)
      return "That element is inside a frame, which Acorn can't pick from. Right-click outside the frame, then try again."
    return null
  }

  const pick = async (tabId: number): Promise<void> => {
    const answer = await api.tabs
      .sendMessage(tabId, { type: 'acorn:pick', mode: 'target' } satisfies PickerMessage)
      .catch(() => null)
    // Only the picker answers `true`. Without it on the page, nothing saw the right-click either.
    if (answer === true) return
    await api.scripting.executeScript({ target: { tabId }, files: ['picker.js'] })
    await api.tabs.sendMessage(tabId, { type: 'acorn:pick', mode: 'hover' } satisfies PickerMessage)
  }

  api.runtime.onInstalled.addListener(() =>
    api.contextMenus.create({
      id: MENU_ID,
      title: 'Ask Acorn about this element',
      contexts: ['page', 'link', 'image', 'video', 'audio'],
    }),
  )
  api.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return
    const notice = refusal(info.frameId, tab.url)
    if (notice) {
      events.open(tab)
      events.refused(notice)
      return
    }
    pick(tab.id).catch(() => events.refused("Acorn couldn't pick an element on that page. Reload it, then try again."))
  })
}
