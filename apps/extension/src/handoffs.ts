import type { BridgeHandoff } from '@acorn/protocol/extensionBridge.ts'
import { matchHandoffPage } from '@acorn/protocol/plugin/handoffs.ts'

// Browser handoffs inside the extension (docs/browser-extension/handoffs.md): which declared handoffs a
// page matches, and which site access shows their buttons. The background and the sidebar both match
// from the cached list. A page address goes to the Node only for a page a handoff matches: when the
// person clicks its chip, or when Home shows the page and looks its item up.

// A handoff on one page: a chip click, or Home's own lookup, which sets `auto`. `start` is what the
// chip's menu chose to do with the item: make a task, or start a workflow in one.
type HandoffStart = 'task' | 'workflow'
export type PageHandoff = {
  pluginId: string
  handoffId: string
  label: string
  url: string
  start?: HandoffStart
  auto?: boolean
}

export const handoffKey = (handoff: Pick<BridgeHandoff, 'pluginId' | 'id'>): string =>
  `${handoff.pluginId}:${handoff.id}`

export const pageHandoffs = (handoffs: readonly BridgeHandoff[], url: string | undefined): BridgeHandoff[] =>
  url ? handoffs.filter((handoff) => matchHandoffPage(handoff, url)) : []

// Whether `url` shows the item a handoff was asked for on: the page matches the same handoff, and every
// capture the two addresses share is equal, so a pull request's Files tab is still that pull request.
export const onHandoffPage = (
  handoffs: readonly BridgeHandoff[],
  handoff: PageHandoff,
  url: string | undefined,
): boolean => {
  const declared = handoffs.find((each) => each.pluginId === handoff.pluginId && each.id === handoff.handoffId)
  const asked = declared && matchHandoffPage(declared, handoff.url)
  const here = declared && url ? matchHandoffPage(declared, url) : null
  if (!asked || !here) return false
  return Object.entries(asked).every(([name, value]) => !(name in here) || here[name] === value)
}

// The browser match pattern for each host a handoff's pages are on. The content-link grammar allows
// one `*.` host wildcard and https only, both of which match patterns can say.
export const siteAccess = (handoff: Pick<BridgeHandoff, 'match'>): string[] => [
  ...new Set(handoff.match.map((pattern) => `https://${new URL(pattern.replace(/\{[^}]*\}/g, 'x')).host}/*`)),
]

// Between the background and a page's content script. The background decides which buttons a page
// gets; the content script only draws them and reports a click. A button on a page that belongs to a
// task is the task chip: the task's name, its agents' state, and an `acorn://` link to it.
export type ChipTask = { title: string; state: { label: string; tone: 'ok' | 'warn' } | null; link: string | null }
// The branch marker on an app a plugin published for a task: the task's branch, the state the plugin
// gives, and an `acorn://` link to the plugin's pane on the task.
export type AppMarker = { branch: string; state: { label: string; tone: 'ok' | 'warn' | 'bad' }; link: string | null }
// The origins the person hid the branch marker on, from its own menu, in `storage.local`.
export const HIDDEN_MARKERS_KEY = 'hiddenMarkers'
export type ContentMessage = {
  type: 'acorn:buttons'
  buttons: { key: string; label: string; anchors: string[]; task: ChipTask | null }[]
  marker: AppMarker | null
  // Whether `acorn://` links open the desktop app, or are copied, as in the sidebar.
  opensLinks: boolean
  // Firefox opens its sidebar only from the extension's own controls, never from a page.
  opensPanel: boolean
}
// `show` opens the panel on the page's task, and `chat` opens it on a new chat about the page. The
// marker's `hide` hides it on the page's origin.
export type ButtonClick =
  | { type: 'acorn:handoff'; key: string; start: HandoffStart }
  | { type: 'acorn:chip'; key: string; action: 'show' | 'chat' }
  | { type: 'acorn:marker'; action: 'show' | 'hide' }
// From the background to the element picker on a task's page: pick the element the person last
// right-clicked, or let them point at one and click it.
export type PickerMessage = { type: 'acorn:pick'; mode: 'hover' | 'target' }
// From the element picker to the background, about one picked element. `acorn:ask.open` starts a
// pick, once the picker's outline is off the screen, and the background screenshots the element and
// names the pick in its answer. `acorn:ask.send` asks the task's agent: in the conversation
// `sessionId`, or in a new chat from the `agent` row when it's null. The background checks every
// field, because the element's HTML and path come from the page. `acorn:ask.cancel` drops what the
// background kept for the pick.
export type AskMessage =
  | {
      type: 'acorn:ask.open'
      // The element's box in the viewport, in CSS pixels, and the device pixels in one, to crop the
      // screenshot by.
      rect: { x: number; y: number; width: number; height: number }
      devicePixelRatio: number
    }
  | {
      type: 'acorn:ask.send'
      pickId: string
      question: string
      html: string
      selector: string
      // The element's size in CSS pixels.
      size: { width: number; height: number }
      sessionId: string | null
      // The row's `choiceKey`.
      agent: string | null
    }
  | { type: 'acorn:ask.cancel'; pickId: string }
// Each answer is either what the box needs, or why it can't go on, in one line.
export type AskOpened =
  | {
      ok: true
      pickId: string
      sessions: { id: string; title: string }[]
      // The rows a new chat can start from, each by its `choiceKey`, and the one to choose first.
      agents: { key: string; label: string }[]
      agent: string | null
      // False when the browser didn't allow a screenshot, so the question goes without one.
      screenshot: boolean
    }
  | { ok: false; reason: string }
// `opensPanel` is false in Firefox, whose sidebar opens only from the extension's own controls.
export type AskSent = { ok: true; opensPanel: boolean } | { ok: false; reason: string }
