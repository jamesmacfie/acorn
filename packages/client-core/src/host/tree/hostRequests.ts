import { TREE_LIMITS, batchBytes } from '@acorn/protocol/tree/messages.ts'
import type { TreeHostResult } from './workerHost'

// The grant behind `mount.host.invoke`, in one place because there are two hosts
// (docs/plugins/remote-points.md § Asking the owner).
//
// The desktop draws a tree into the DOM and the terminal draws the same tree into cells, and both
// mount it through the same worker host. What a contributor is allowed to ask its owner to do must not
// depend on which of them is running: a check that lived in one component would be a check the other
// could quietly diverge from, and the divergence would be a permission.
//
// Overlays are the opposite case and are deliberately not here. Opening one is the desktop's answer
// and `unsupportedOverlay` is the terminal's, because a terminal has no iframe to put a rectangle in
// and inventing a cell-drawn canvas is not a thing this project should do.

/**
 * What the host knows about one request, beyond its payload.
 *
 * `byPerson` is true only when a person pressed something or typed a key inside the asking tree in
 * the last second. Focus alone isn't enough, because a timer can fire while focus sits in a tree. An
 * owner whose action is a person's act, such as reloading a page or interrupting a terminal, refuses
 * without it (docs/plugins/toolbar-actions.md).
 */
export type OwnerInvocation = { byPerson: boolean }

export type OwnerActions = Record<string, (payload: unknown, invocation: OwnerInvocation) => unknown | Promise<unknown>>

/** How long after a press a request still counts as the person's. Long enough to cover the worker
 *  round trip, short enough that it can't outlive the gesture. */
export const GESTURE_WINDOW_MS = 1_000

/**
 * When a person last pressed or typed inside one mounted contribution, on the desktop.
 *
 * Capturing, because the target is inside the host's own components and may stop the bubble. Only
 * trusted events count, so a script dispatching a synthetic press proves nothing. The terminal's
 * equivalent watches its stops instead (apps/tui/src/keys/stops.ts).
 */
export function createGestureClock(): { watch(element: HTMLElement): () => void; recent(): boolean } {
  let at = 0
  const mark = (event: Event): void => { if (event.isTrusted) at = Date.now() }
  return {
    watch: (element) => {
      element.addEventListener('pointerdown', mark, { capture: true })
      element.addEventListener('keydown', mark, { capture: true })
      return () => {
        element.removeEventListener('pointerdown', mark, { capture: true })
        element.removeEventListener('keydown', mark, { capture: true })
      }
    },
    recent: () => at > 0 && Date.now() - at <= GESTURE_WINDOW_MS,
  }
}

/** Refuse or run one owner action, and measure the answer. */
export async function answerOwnerInvoke(input: {
  /** What the owning extension point declared. The owner plugin's published contract. */
  declared: readonly string[]
  /** What this particular `Slot` bound. The instance's consent, closing over which item it drew. */
  actions: OwnerActions
  name: string
  payload: unknown
  /** Whether a person pressed something in this mount just now. The host measures it; the owner decides. */
  byPerson: boolean
}): Promise<TreeHostResult> {
  const refuse = (message: string): TreeHostResult => ({ ok: false, error: { code: 'unknown_action', message } })
  // Both lists, in this order. A name in one and not the other is a mistake on the owner's side, and
  // honouring it would make whichever list is narrower decorative.
  if (!input.declared.includes(input.name)) return refuse(`'${input.name}' is not an action this extension point declares`)
  const handler = input.actions[input.name]
  if (!handler) return refuse(`'${input.name}' is not bound here`)
  const body = await handler(input.payload, { byPerson: input.byPerson })
  // Measured on the way out for the same reason the request was on the way in: this channel carries
  // identifiers and outcomes, and an owner handing back a whole record set would be using it as a data
  // path. Anything larger belongs on the plugin's own route.
  if (batchBytes(body ?? null) > TREE_LIMITS.hostRequestBytes) {
    return { ok: false, error: { code: 'too_large', message: `an action result is capped at ${TREE_LIMITS.hostRequestBytes} bytes` } }
  }
  return { ok: true, body: body ?? null }
}

/** The `host` a compiled contributor gets at a point that declares owner actions: the same check a
 *  loaded tree's requests get, with a refusal thrown as an error that carries its code. Both hosts'
 *  `Slot`s hand it over, each with its own way of hearing a person's press. */
export const compiledOwnerHost = (input: {
  declared: () => readonly string[]
  actions: () => OwnerActions
  byPerson: () => boolean
}): { invoke: (name: string, payload?: unknown) => Promise<unknown> } => ({
  invoke: async (name, payload) => {
    const result = await answerOwnerInvoke({ declared: input.declared(), actions: input.actions(), name, payload, byPerson: input.byPerson() })
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    return result.body
  },
})

/** What a host with no overlay frames says. A plugin catches this and leaves its static preview up, so
 *  a terminal shows the owner's chip rather than a control that could never do anything. */
export const unsupportedOverlay = (): TreeHostResult =>
  ({ ok: false, error: { code: 'unsupported_host', message: 'this host does not present plugin overlays' } })

/** What a host says to an operation it does not recognise. Denied rather than forwarded and ignored:
 *  a newer bundle asking for something this build has never heard of gets an answer. */
export const unknownHostOp = (op: string): TreeHostResult =>
  ({ ok: false, error: { code: 'bad_request', message: `unknown host request ${op}` } })
