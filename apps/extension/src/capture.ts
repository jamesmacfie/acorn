import { MAX_AGENT_CONTEXT_BYTES } from '@acorn/protocol/agentContext.ts'
import { TURN_MAX_ATTACHMENTS, TURN_MAX_CONTEXTS, type BridgeInputPart } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi, Tab } from './browser'

// Page capture: the link, the selected text, or a screenshot of the tab showing beside the sidebar.
// A capture stays in the draft, in this browser, until the person sends it. Nothing here talks to the
// Node.

export type CaptureKind = 'link' | 'selection' | 'screenshot'

type CaptureSource = { id: string; url: string; title: string; capturedAt: number }
export type PageCapture =
  | (CaptureSource & { kind: 'link' })
  | (CaptureSource & { kind: 'selection'; text: string })
  // What a plugin proposed for the agent to read about an item the person handed off.
  | (CaptureSource & { kind: 'context'; label: string; content: string })
  // `attachmentId` is set once the Node holds the screenshot, so a retried send doesn't upload it again.
  | (CaptureSource & {
      kind: 'screenshot'
      dataUrl: string
      mediaType: 'image/jpeg'
      byteSize: number
      attachmentId?: string
    })

// The largest screenshot a draft keeps. Drafts live in `storage.local`, which Chrome limits to 10 MiB
// for the whole extension, and a screenshot is stored as base64, a third larger than its bytes.
const CAPTURE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
// JPEG at this quality keeps page text legible in a fraction of the bytes a PNG takes.
const SCREENSHOT_QUALITY = 90

export class CaptureFailure extends Error {
  constructor(
    readonly reason: 'no_access' | 'changed' | 'empty' | 'limit' | 'failed',
    message: string,
  ) {
    super(message)
  }
}

// What the person does when the browser hasn't let the sidebar read the page. Both browsers give
// `activeTab` access for a click on the toolbar button; a click inside the sidebar doesn't count.
const NO_ACCESS_GUIDANCE =
  "Acorn can't read this page yet. Click the Acorn button in the toolbar while the page is showing, then capture again."
// A site the person granted lets the sidebar read the page, but Firefox takes a screenshot only of a
// page the toolbar button was clicked on, or with access to every site.
const SCREENSHOT_ACCESS_GUIDANCE =
  'The browser takes a screenshot only of a page you clicked the Acorn button in the toolbar on. Click it while the page is showing, then try again.'

// The tab beside the sidebar, if this extension may read it.
async function readableTab(api: BrowserApi): Promise<Tab & { id: number; url: string }> {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined || !tab.url) throw new CaptureFailure('no_access', NO_ACCESS_GUIDANCE)
  return tab as Tab & { id: number; url: string }
}

// Runs `read` against the active tab, then checks the same page is still showing. A switch of tab or
// a navigation while it ran would label one page's content with another page's address.
async function fromActiveTab<Result>(
  api: BrowserApi,
  read: (tab: Tab & { id: number }) => Promise<Result>,
  refused = NO_ACCESS_GUIDANCE,
) {
  const before = await readableTab(api)
  let result: Result
  try {
    result = await read(before)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/permission|access|not allowed|cannot be scripted|missing host/i.test(message))
      throw new CaptureFailure('no_access', refused)
    throw new CaptureFailure('failed', `The browser couldn't capture this page: ${message}`)
  }
  const after = await readableTab(api).catch(() => null)
  if (after?.id !== before.id || after.url !== before.url)
    throw new CaptureFailure('changed', 'The page changed while it was being captured, so nothing was kept. Try again.')
  return { tab: before, result }
}

export async function capturePage(api: BrowserApi, kind: CaptureKind): Promise<PageCapture> {
  const source = (tab: Tab & { url: string }): CaptureSource => ({
    id: crypto.randomUUID(),
    url: tab.url,
    title: tab.title?.trim() || tab.url,
    capturedAt: Date.now(),
  })
  if (kind === 'link') return { ...source(await readableTab(api)), kind }
  if (kind === 'selection') {
    const { tab, result } = await fromActiveTab(api, async (target) => {
      const [frame] = await api.scripting.executeScript({
        target: { tabId: target.id },
        func: () => globalThis.getSelection?.()?.toString() ?? '',
      })
      return frame?.result ?? ''
    })
    const text = result.trim()
    if (!text) throw new CaptureFailure('empty', 'Nothing is selected on this page. Select some text, then try again.')
    return { ...source(tab as Tab & { url: string }), kind, text }
  }
  const { tab, result: dataUrl } = await fromActiveTab(
    api,
    (target) => api.tabs.captureVisibleTab(target.windowId, { format: 'jpeg', quality: SCREENSHOT_QUALITY }),
    SCREENSHOT_ACCESS_GUIDANCE,
  )
  return {
    ...source(tab as Tab & { url: string }),
    kind,
    dataUrl,
    mediaType: 'image/jpeg',
    byteSize: base64Bytes(dataUrl.slice(dataUrl.indexOf(',') + 1)),
  }
}

export const screenshotData = (capture: Extract<PageCapture, { kind: 'screenshot' }>): string =>
  capture.dataUrl.slice(capture.dataUrl.indexOf(',') + 1)

const base64Bytes = (data: string): number => Math.floor((data.length * 3) / 4) - (data.match(/=*$/)?.[0].length ?? 0)

const contextLabel = (capture: Exclude<PageCapture, { kind: 'screenshot' }>): string =>
  capture.kind === 'link'
    ? `Page: ${capture.title}`
    : capture.kind === 'selection'
      ? `Selected text from ${capture.title}`
      : capture.label

const contextContent = (capture: Exclude<PageCapture, { kind: 'screenshot' }>): string =>
  capture.kind === 'link'
    ? `${capture.title}\n${capture.url}`
    : capture.kind === 'selection'
      ? `From ${capture.url}:\n\n${capture.text}`
      : capture.content

// The context part a link, selection, or handed-off item becomes. The Node hands it to the agent in a block marked as
// captured material, so page text can't pass for the person's own message.
function contextPart(
  capture: Exclude<PageCapture, { kind: 'screenshot' }>,
): Extract<BridgeInputPart, { type: 'context' }> {
  return {
    type: 'context',
    contextId: capture.id,
    label: contextLabel(capture).slice(0, 500),
    content: contextContent(capture),
    source: 'browser-extension',
    ...(capture.url.length <= 1_000 ? { resourceId: capture.url } : {}),
    capturedAt: capture.capturedAt,
  }
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).byteLength

// Adds a capture to a draft's list, or says which limit it would pass. The limits are the agents
// plugin's for one turn, so a draft that holds them can always be sent.
export function withCapture(captures: readonly PageCapture[], capture: PageCapture): PageCapture[] {
  if (capture.kind === 'screenshot') {
    if (capture.byteSize > CAPTURE_IMAGE_MAX_BYTES)
      throw new CaptureFailure(
        'limit',
        `This screenshot is ${megabytes(capture.byteSize)}, over the ${megabytes(CAPTURE_IMAGE_MAX_BYTES)} a draft keeps. Make the window smaller and try again.`,
      )
    if (captures.filter((other) => other.kind === 'screenshot').length >= TURN_MAX_ATTACHMENTS)
      throw new CaptureFailure('limit', `A message can carry ${TURN_MAX_ATTACHMENTS} screenshots at most.`)
    return [...captures, capture]
  }
  const contexts = [...captures, capture].flatMap((other) => (other.kind === 'screenshot' ? [] : [contextPart(other)]))
  if (contexts.length > TURN_MAX_CONTEXTS)
    throw new CaptureFailure('limit', `A message can carry ${TURN_MAX_CONTEXTS} links and selections at most.`)
  if (contexts.reduce((total, part) => total + utf8Bytes(part.content), 0) > MAX_AGENT_CONTEXT_BYTES)
    throw new CaptureFailure(
      'limit',
      `Captured text is limited to ${MAX_AGENT_CONTEXT_BYTES / 1024} KiB a message. Select less, or remove a capture.`,
    )
  return [...captures, capture]
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

// The turn the agents plugin receives: the message, each link and selection as context, then each
// screenshot by the attachment the Node holds for it.
export function turnInput(
  text: string,
  captures: readonly PageCapture[],
  attachmentIds: ReadonlyMap<string, string>,
): BridgeInputPart[] {
  return [
    ...(text ? [{ type: 'text' as const, text }] : []),
    ...captures.flatMap((capture) => (capture.kind === 'screenshot' ? [] : [contextPart(capture)])),
    ...captures.flatMap((capture): BridgeInputPart[] => {
      const attachmentId = capture.kind === 'screenshot' ? attachmentIds.get(capture.id) : undefined
      return attachmentId
        ? [{ type: 'image', attachmentId, alt: `Screenshot of ${capture.title}`.slice(0, 1_000) }]
        : []
    }),
  ]
}
