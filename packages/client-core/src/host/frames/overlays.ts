import { createSignal } from 'solid-js'

// Which plugin overlay is on screen, and for whom (docs/plugins.md § Frame contribution kind).
//
// One at a time, and a plain signal rather than a registry: an overlay covers the window, so "two open"
// is not a state the surface has. The second would hide the first and the reader would have no way to
// tell which Escape dismissed. Opening a second one replaces the first, the same way the shell's own
// palettes behave.
//
// Kept out of the registries folder and JSX-free deliberately: the verb that opens an overlay lives in
// plugins/chrome/actions.ts and the surface that renders one in plugins/frames/register.ts, and both
// have unit tests that run in a bare Node environment with no Solid transform (registries/slots.ts
// states the same split).
//
// An invocation rather than a pair of ids, because an overlay is now two things at once. A manifest
// command opens one with nothing to say and nothing to hear back, which is what the ⌘P file palette has
// always been. A remote tree opens its own companion overlay with an input and waits for a result
// (docs/plugins.md § Companion overlays). Both are the same record; the second simply fills the two
// fields the first leaves empty.

/** One opening of one overlay. `id` is what keys the iframe, so reopening the same surface builds a
 *  fresh document rather than inheriting whatever the last one had drawn. */
export type OverlayInvocation = {
  id: string
  pluginId: string
  surface: string
  /** What the opener handed over, delivered to the frame as `bridge.context.input`. Absent when a
   *  command opened it, because a command has no instance to name. */
  input?: unknown
  /** Called exactly once, with the frame's result or `null` for every dismissal. Absent for a command,
   *  which has nobody waiting. */
  settle?: (result: unknown | null) => void
}

let seq = 0
const [current, setCurrent] = createSignal<OverlayInvocation | null>(null)

/** Settle whatever is open with `null` and clear it. The single exit: every dismissal path in the app
 *  goes through here, so "the waiter is always resolved" is one line rather than a rule to remember. */
const clear = (): void => {
  const open = current()
  setCurrent(null)
  open?.settle?.(null)
}

/** The command verb's opener (../chrome/actions.ts). No input, no result: a command names a surface and
 *  nothing else, which is why it could never have addressed one attachment out of five. */
export const openPluginOverlay = (pluginId: string, surface: string): void => {
  clear()
  setCurrent({ id: `o${++seq}`, pluginId, surface })
}

/**
 * The tree's opener: present this overlay with an input and resolve when it closes.
 *
 * Resolves with `null` for every dismissal — backdrop, close button, Escape, another overlay opening,
 * the source slot unmounting, navigating away — and with the frame's own value when it calls
 * `bridge.ui.close(result)`. Callers never have to distinguish "cancelled" from "went away".
 */
export const openPluginOverlayInvocation = (input: {
  pluginId: string
  surface: string
  input?: unknown
}): { id: string; result: Promise<unknown | null> } => {
  clear()
  const id = `o${++seq}`
  let settled = false
  const result = new Promise<unknown | null>((resolve) => {
    setCurrent({
      id,
      pluginId: input.pluginId,
      surface: input.surface,
      ...(input.input === undefined ? {} : { input: input.input }),
      // Guarded rather than trusted: `clear()` runs on every dismissal path and a frame may also have
      // called `close(result)` on its way out, so both can reach one invocation.
      settle: (value) => {
        if (settled) return
        settled = true
        resolve(value)
      },
    })
  })
  // The id comes back so the opener can dismiss its own invocation later without dismissing whatever
  // replaced it (`closePluginOverlayFrom`). A tree unmounting is the case that needs it.
  return { id, result }
}

/** Dismiss whatever is open. What every backdrop click, close button and Escape binding calls. */
export const closePluginOverlay = (): void => clear()

/** Dismiss whatever is open, handing the opener a result. Only a frame whose surface is an overlay
 *  reaches this, through `bridge.ui.close(result)` (./broker.ts). */
export const closePluginOverlayWith = (result: unknown): void => {
  const open = current()
  setCurrent(null)
  open?.settle?.(result)
}

/** Dismiss whatever this contribution opened, if it is still the thing on screen. The source slot
 *  unmounting, and the same check for the plugin being disabled: an overlay outliving the tree that
 *  asked for it is a modal nobody can answer. */
export const closePluginOverlayFrom = (id: string): void => {
  if (current()?.id === id) clear()
}

export const pluginOverlayOpen = (pluginId: string, surface: string): boolean => {
  const open = current()
  return open?.pluginId === pluginId && open.surface === surface
}

/** The open invocation, for the surface that draws it: it needs the id to key the iframe and the input
 *  to put in the frame's context. */
export const pluginOverlayInvocation = (): OverlayInvocation | null => current()
