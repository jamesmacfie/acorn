import type { BridgeOperation, BridgeResults } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi, Tab } from '../browser'
import { CaptureFailure, capturePage, withCapture } from '../capture'
import { changeDraft, loadDestination, saveDestination } from '../localState'
import { CallFailure, type BridgeCall, type RequestTarget } from '../messages'

const MENU_ID = 'add-to-acorn-chat'

// Add to Acorn chat, on a text selection. The entry is always on the menu, so it never comes and goes
// with state the page doesn't show. A click opens the panel, reads the selection through page capture
// as the composer's button does, and adds it to the draft of the conversation the panel would open for
// the current task. When something stops it, the panel says why, so the selection never vanishes
// without a word. docs/browser-extension/page-capture.md.
export function selectionMenu(
  api: BrowserApi,
  events: {
    // Called inside the click, where the browser still counts the person's gesture.
    open(tab: Tab): void
    selectedNode(): Promise<string | null>
    read<Op extends BridgeOperation>(operation: Extract<BridgeCall, { op: Op }>): Promise<BridgeResults[Op]>
    // The selection is in this conversation's draft.
    added(target: RequestTarget): void
    // Why it isn't, in one line.
    refused(notice: string): void
  },
): void {
  // Returns the conversation the selection went to, or why it went nowhere.
  const add = async (windowId: number): Promise<RequestTarget | string> => {
    const nodeId = await events.selectedNode()
    if (!nodeId) return "No Node is selected, so the selection wasn't added. Choose or pair a Node, then try again."
    const { projectId, taskId, sessionId: shown } = await loadDestination(api.storage.local, nodeId)
    if (!projectId || !taskId)
      return "No task is current, so the selection wasn't added. Open a chat in a task, then try again."
    const { sessions } = await events.read({ op: 'sessions.list', nodeId, taskId })
    // The conversation the panel last showed for the task, or else its newest, as Chat opens.
    const sessionId = (sessions.find((session) => session.id === shown) ?? sessions[0])?.id
    if (!sessionId) return "The current task has no chat yet, so the selection wasn't added. Start one, then try again."
    const capture = await capturePage(api, 'selection', windowId)
    const target = { nodeId, projectId, taskId, sessionId }
    await changeDraft(api.storage.local, target, (draft) => ({
      ...draft,
      captures: withCapture(draft.captures ?? [], capture),
    }))
    // A panel the browser didn't open shows this conversation when the person next opens it.
    await saveDestination(api.storage.local, nodeId, { projectId, taskId, sessionId })
    return target
  }

  api.runtime.onInstalled.addListener(() =>
    api.contextMenus.create({ id: MENU_ID, title: 'Add to Acorn chat', contexts: ['selection'] }),
  )
  api.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab) return
    events.open(tab)
    add(tab.windowId).then(
      (result) => (typeof result === 'string' ? events.refused(result) : events.added(result)),
      (error: unknown) =>
        events.refused(
          error instanceof CaptureFailure
            ? error.message
            : error instanceof CallFailure
              ? `The selection wasn't added: ${error.message}`
              : // Only storage is left to fail, and only by being full.
                "Browser storage is full, so the selection wasn't added. Send or remove captures in other conversations, then try again.",
        ),
    )
  })
}
