import { TREE_LIMITS, batchBytes } from '@acorn/protocol/tree/messages.ts'
import type { TreeHostResult } from './workerHost'

// The grant behind `mount.host.invoke`, in one place because there are two hosts
// (docs/plugins.md § Asking the owner).
//
// The desktop draws a tree into the DOM and the terminal draws the same tree into cells, and both
// mount it through the same worker host. What a contributor is allowed to ask its owner to do must not
// depend on which of them is running: a check that lived in one component would be a check the other
// could quietly diverge from, and the divergence would be a permission.
//
// Overlays are the opposite case and are deliberately not here. Opening one is the desktop's answer
// and `unsupportedOverlay` is the terminal's, because a terminal has no iframe to put a rectangle in
// and inventing a cell-drawn canvas is not a thing this project should do.

export type OwnerActions = Record<string, (payload: unknown) => unknown | Promise<unknown>>

/** Refuse or run one owner action, and measure the answer. */
export async function answerOwnerInvoke(input: {
  /** What the owning extension point declared. The owner plugin's published contract. */
  declared: readonly string[]
  /** What this particular `Slot` bound. The instance's consent, closing over which item it drew. */
  actions: OwnerActions
  name: string
  payload: unknown
}): Promise<TreeHostResult> {
  const refuse = (message: string): TreeHostResult => ({ ok: false, error: { code: 'unknown_action', message } })
  // Both lists, in this order. A name in one and not the other is a mistake on the owner's side, and
  // honouring it would make whichever list is narrower decorative.
  if (!input.declared.includes(input.name)) return refuse(`'${input.name}' is not an action this extension point declares`)
  const handler = input.actions[input.name]
  if (!handler) return refuse(`'${input.name}' is not bound here`)
  const body = await handler(input.payload)
  // Measured on the way out for the same reason the request was on the way in: this channel carries
  // identifiers and outcomes, and an owner handing back a whole record set would be using it as a data
  // path. Anything larger belongs on the plugin's own route.
  if (batchBytes(body ?? null) > TREE_LIMITS.hostRequestBytes) {
    return { ok: false, error: { code: 'too_large', message: `an action result is capped at ${TREE_LIMITS.hostRequestBytes} bytes` } }
  }
  return { ok: true, body: body ?? null }
}

/** What a host with no overlay frames says. A plugin catches this and leaves its static preview up, so
 *  a terminal shows the owner's chip rather than a control that could never do anything. */
export const unsupportedOverlay = (): TreeHostResult =>
  ({ ok: false, error: { code: 'unsupported_host', message: 'this host does not present plugin overlays' } })

/** What a host says to an operation it does not recognise. Denied rather than forwarded and ignored:
 *  a newer bundle asking for something this build has never heard of gets an answer. */
export const unknownHostOp = (op: string): TreeHostResult =>
  ({ ok: false, error: { code: 'bad_request', message: `unknown host request ${op}` } })
