import { createSignal } from 'solid-js'

// Transient, self-dismissing feedback. There was no toast system at all, and the workarounds were
// the clearest evidence one was missing: three plugins invented text-channel toasts (notes' "saved
// ·" in its toolbar, context's "Sent." span, memory's success-and-failure-through-one-muted-span),
// while the frame bridge already promised `bridge.ui.toast` and quietly routed it into the
// notification bell, so a frame saying "Copied to the clipboard" left a permanent inbox entry.
//
// In notifications/ rather than ui/: a module-level signal store is shell state, and the ui/
// purity rule in tools/arch/boundaries.test.ts rightly keeps it out.
//
// The state lives here and the component in ToastHost.tsx, because `@acorn/plugin-api/client`
// re-exports `toast()` and that barrel may not reach a .tsx module: one Solid component on it
// makes the whole entrypoint unloadable from a plugin's node-environment tests.
//
// Minimal by design: no actions, no promise tracking, no custom JSX bodies. A toast that needs a
// button is an Alert (the user must act) or a notification-bell entry (it must persist). Toasts
// are for "you may now stop wondering whether that worked".

export type ToastTone = 'neutral' | 'success' | 'danger'

export type Toast = { id: number; message: string; tone: ToastTone; durationMs: number }

const [toasts, setToasts] = createSignal<Toast[]>([])
let nextId = 0

/** Default lifetimes. A failure gets longer because it is the one you might need to read twice. */
const DEFAULT_MS: Record<ToastTone, number> = { neutral: 4000, success: 4000, danger: 8000 }

export function toast(message: string, opts?: { tone?: ToastTone; durationMs?: number }): void {
  if (!message) return
  const tone = opts?.tone ?? 'neutral'
  setToasts((current) => [...current, {
    id: ++nextId,
    message,
    tone,
    durationMs: opts?.durationMs ?? DEFAULT_MS[tone],
  }])
}

export const activeToasts = toasts
export const dismissToast = (id: number) => setToasts((current) => current.filter((entry) => entry.id !== id))
