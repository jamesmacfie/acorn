import type {
  BridgeAgentChoice,
  BridgeAgentSession,
  BridgeOperation,
  BridgeResults,
} from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi, Tab } from '../browser'
import { capturePage, cropScreenshot, screenshotData, turnInput, withCapture, type PageCapture } from '../capture'
import type { AskMessage, AskOpened, AskSent, PickerMessage } from '../handoffs'
import { saveDestination } from '../localState'
import { CallFailure, choiceKey, isUncertain, type BridgeCall, type RequestTarget } from '../messages'
import { errorGuidance } from '../sidebar/guidance'
import type { PageTask } from '../taskPages'

const MENU_ID = 'ask-acorn-about-element'
// The `choiceKey` of the row a new chat from the box last started from, per Node.
const askAgentKey = (nodeId: string) => `askAgent:${nodeId}`
const MAX_QUESTION_CHARS = 20_000
// The picker cuts the element's HTML to this size.
const MAX_HTML_BYTES = 50 * 1024

// What the background keeps for the one box open on a tab: where it asks, what it may choose from,
// and the operation keys of its sends.
type Pick = {
  id: string
  nodeId: string
  projectId: string
  taskId: string
  pickedAt: number
  sessions: BridgeAgentSession[]
  // The rows of `agents.choices` that can start.
  agents: BridgeAgentChoice[]
  // The element as the person saw it, and its `attachmentId` once the Node holds it. Null when the
  // browser didn't allow a screenshot.
  screenshot: Extract<PageCapture, { kind: 'screenshot' }> | null
  // A new chat's key, kept with its row, and the chat once the Node made it.
  create: { agent: string; key: string; sessionId: string | null } | null
  // A turn's key, kept with the conversation and input it went with.
  submit: { key: string; sessionId: string; input: string } | null
}

// Ask Acorn about this element, on a right-click anywhere on a page. Like Add to Acorn chat, the entry
// is always on the menu. On a page that belongs to a task, a click starts the element picker in the
// page. When the picker script was already there, it saw the right-click and picks that element;
// otherwise it's injected now and the person points at the element. When the page can't have the
// picker, the panel opens and says why in one line.
//
// Then the box asks the background for the task's conversations and agents, and sends the question
// through it. See docs/browser-extension/element-picker.md.
export function askElement(
  api: BrowserApi,
  events: {
    // Called inside the click, where the browser still counts the person's gesture.
    open(tab: Tab): void
    selectedNode(): string | null
    // The first of the selected Node's tasks the page belongs to.
    pageTask(url: string | undefined): PageTask | null
    // The task's conversations, or undefined until they are read.
    sessions(taskId: string): readonly BridgeAgentSession[] | undefined
    read<Op extends BridgeOperation>(operation: Extract<BridgeCall, { op: Op }>): Promise<BridgeResults[Op]>
    // Why nothing was picked, in one line.
    refused(notice: string): void
    // A question went to this conversation.
    sent(target: RequestTarget): void
  },
): void {
  // By tab. A new box on the tab replaces the last one's.
  const picks = new Map<number, Pick>()

  // From what the background holds now, so the panel can open inside the click. A background that has
  // only just started may not have the Node's tasks yet, but it runs as long as a Node's host is
  // connected, and without one nothing can be asked.
  const refusal = (frameId: number | undefined, url: string | undefined): string | null => {
    if (!events.selectedNode())
      return 'No Node is selected, so there is no agent to ask. Choose or pair a Node, then try again.'
    if (!events.pageTask(url))
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

  // The picked element, cut from a screenshot of the tab. Null when the browser refuses one, as both
  // browsers do on a granted site without `activeTab`, which a pick from the chip's menu has, or when
  // anything else stops it, because the question can go without it.
  const screenshot = async (
    windowId: number,
    url: string,
    { rect, devicePixelRatio }: Extract<AskMessage, { type: 'acorn:ask.open' }>,
  ): Promise<Pick['screenshot']> => {
    const numbers = [rect?.x, rect?.y, rect?.width, rect?.height, devicePixelRatio]
    if (!numbers.every(Number.isFinite) || !(devicePixelRatio > 0)) return null
    try {
      const page = await capturePage(api, 'screenshot', windowId)
      // Another page came to the front of the window first.
      if (page.kind !== 'screenshot' || page.url !== url) return null
      const cropped = await cropScreenshot(page, rect, devicePixelRatio)
      // Throws when it's larger than a capture may be.
      if (cropped) withCapture([], cropped)
      return cropped
    } catch {
      return null
    }
  }

  const open = async (
    tabId: number,
    windowId: number,
    url: string,
    message: Extract<AskMessage, { type: 'acorn:ask.open' }>,
  ): Promise<AskOpened> => {
    const nodeId = events.selectedNode()
    const match = events.pageTask(url)
    if (!nodeId || !match) return { ok: false, reason: refusal(0, url)! }
    const { task } = match
    const [shot, sessions, { choices }, stored] = await Promise.all([
      screenshot(windowId, url, message),
      events.sessions(task.id) ??
        events.read({ op: 'sessions.list', nodeId, taskId: task.id }).then((result) => result.sessions),
      events.read({ op: 'agents.choices', nodeId }),
      api.storage.local.get([askAgentKey(nodeId)]),
    ])
    const pick: Pick = {
      id: crypto.randomUUID(),
      nodeId,
      projectId: task.projectId,
      taskId: task.id,
      pickedAt: Date.now(),
      // An archived conversation takes no new messages.
      sessions: sessions.filter((session) => !session.archivedAt),
      agents: choices.filter((choice) => choice.available),
      screenshot: shot,
      create: null,
      submit: null,
    }
    picks.set(tabId, pick)
    const keys = pick.agents.map((agent) => choiceKey(agent))
    const remembered = stored[askAgentKey(nodeId)]
    return {
      ok: true,
      pickId: pick.id,
      task: task.title,
      sessions: pick.sessions.map(({ id, title }) => ({ id, title })),
      agents: pick.agents.map((agent, index) => ({ key: keys[index]!, label: agent.label })),
      agent: keys.find((key) => key === remembered) ?? keys[0] ?? null,
      screenshot: !!shot,
    }
  }

  // Checks the request against what the background read when the box opened, then uploads the
  // screenshot, makes the new chat if one was asked for, and the turn. A retry of the same pick reuses
  // the attachment and both keys, so the Node holds one picture and makes at most one chat and one turn.
  const send = async (
    tabId: number,
    title: string,
    url: string,
    message: Extract<AskMessage, { type: 'acorn:ask.send' }>,
  ): Promise<AskSent> => {
    const pick = picks.get(tabId)
    if (pick?.id !== message.pickId)
      return { ok: false, reason: 'This box is out of date, so nothing was sent. Pick the element again.' }
    if (events.selectedNode() !== pick.nodeId || events.pageTask(url)?.task.id !== pick.taskId)
      return {
        ok: false,
        reason:
          'This page no longer belongs to the task the box was opened for, so nothing was sent. Pick the element again.',
      }
    const question = typeof message.question === 'string' ? message.question.trim() : ''
    if (!question || question.length > MAX_QUESTION_CHARS)
      return { ok: false, reason: `Write a question of up to ${MAX_QUESTION_CHARS.toLocaleString('en')} characters.` }
    if (typeof message.html !== 'string' || new TextEncoder().encode(message.html).byteLength > MAX_HTML_BYTES)
      return { ok: false, reason: "The element's HTML is too large to send." }
    const session = message.sessionId === null ? null : pick.sessions.find((each) => each.id === message.sessionId)
    if (session === undefined)
      return { ok: false, reason: "That conversation isn't one of this task's, so nothing was sent. Choose another." }
    const agent = session ? null : pick.agents.find((each) => choiceKey(each) === message.agent)
    if (agent === undefined)
      return { ok: false, reason: "That agent can't start a chat on this Node, so nothing was sent. Choose another." }

    const { width, height } = message.size
    const capture = {
      kind: 'context' as const,
      id: pick.id,
      url,
      title,
      capturedAt: pick.pickedAt,
      label: `Element on ${title}`,
      content: `Page: ${url}\nCSS path: ${message.selector}\nSize: ${width} × ${height} CSS pixels\n\n${message.html}`,
    }
    const shot = pick.screenshot
    const captures = withCapture([], capture)
    if (shot) captures.push(shot)
    let stage: 'upload' | 'create' | 'submit' = 'upload'
    let sessionId: string
    try {
      if (shot)
        shot.attachmentId ??= (
          await events.read({
            op: 'attachment.upload',
            nodeId: pick.nodeId,
            taskId: pick.taskId,
            filename: `Screenshot of ${new URL(url).hostname || 'page'}.jpg`,
            mediaType: shot.mediaType,
            data: screenshotData(shot),
          })
        ).attachment.id
      const input = turnInput(question, captures, new Map(shot?.attachmentId ? [[shot.id, shot.attachmentId]] : []))
      stage = 'create'
      if (agent) {
        if (pick.create?.agent !== choiceKey(agent))
          pick.create = { agent: choiceKey(agent), key: crypto.randomUUID(), sessionId: null }
        const create = pick.create
        create.sessionId ??= (
          await events.read({
            op: 'session.create',
            nodeId: pick.nodeId,
            taskId: pick.taskId,
            providerId: agent.providerId,
            profileId: agent.profileId,
            ...(agent.customAgentId ? { customAgentId: agent.customAgentId } : {}),
            ...(agent.account ? { account: agent.account } : {}),
            key: create.key,
          })
        ).session.id
        sessionId = create.sessionId
      } else sessionId = session!.id
      stage = 'submit'
      // The same question about the same element, to the same conversation, is the same turn.
      const sending = JSON.stringify(input)
      if (pick.submit?.sessionId !== sessionId || pick.submit.input !== sending)
        pick.submit = { key: crypto.randomUUID(), sessionId, input: sending }
      await events.read({ op: 'turn.submit', nodeId: pick.nodeId, sessionId, input, key: pick.submit.key })
    } catch (error) {
      const failure = error instanceof CallFailure ? error : new CallFailure('node_error', String(error))
      if (!isUncertain(failure.code)) return { ok: false, reason: errorGuidance(failure) }
      const reasons = {
        upload: "The Node didn't confirm the screenshot. Send again to retry; the Node keeps one copy.",
        create: "The Node didn't confirm the new chat. Send again to retry; the Node won't make a second one.",
        submit:
          "The Node didn't confirm this message, so it may have arrived. Send again to retry; the Node makes at most one turn.",
      }
      return { ok: false, reason: reasons[stage] }
    }

    picks.delete(tabId)
    const target = { nodeId: pick.nodeId, projectId: pick.projectId, taskId: pick.taskId, sessionId }
    // The question went. Full storage only loses the remembered agent and where the panel opens next.
    await Promise.all([
      agent ? api.storage.local.set({ [askAgentKey(pick.nodeId)]: choiceKey(agent) }) : undefined,
      saveDestination(api.storage.local, pick.nodeId, { projectId: pick.projectId, taskId: pick.taskId, sessionId }),
    ]).catch(() => undefined)
    events.sent(target)
    return { ok: true, opensPanel: !!api.sidePanel }
  }

  // Only from the picker in a page's top frame. A page can't message the extension itself, but the
  // element's HTML and path come from the page, so every value is checked here.
  api.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const message = raw as AskMessage | null
    const tab = sender.tab
    if (
      !message ||
      !String(message.type).startsWith('acorn:ask.') ||
      sender.frameId !== 0 ||
      tab?.id === undefined ||
      !sender.url
    )
      return
    const tabId = tab.id
    if (message.type === 'acorn:ask.cancel') {
      if (picks.get(tabId)?.id === message.pickId) picks.delete(tabId)
      return
    }
    // Inside the person's click on Send, where the browser still counts the gesture.
    if (message.type === 'acorn:ask.send') events.open(tab)
    const answer =
      message.type === 'acorn:ask.open'
        ? open(tabId, tab.windowId, sender.url, message)
        : send(tabId, tab.title?.trim() || sender.url, sender.url, message)
    answer
      .catch((error: unknown): AskOpened | AskSent => ({
        ok: false,
        reason: error instanceof CallFailure ? errorGuidance(error) : "Acorn couldn't reach the Node. Try again.",
      }))
      .then(sendResponse)
    return true
  })

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
