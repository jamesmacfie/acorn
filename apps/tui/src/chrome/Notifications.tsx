/** @jsxImportSource @opentui/solid */
import { For, onCleanup } from 'solid-js'
import { activeToasts, dismissToast, type Toast } from '@acorn/client-core/features/notifications/toast.ts'
import { Alert } from '../kit/showing'

// Transient feedback, one line each, above the footer.
//
// The same store the desktop's `ToastHost` draws (features/notifications/toast.ts), so
// `bridge.ui.toast` and every plugin that calls `toast()` lands here without knowing there are two
// hosts. What changes is the pixels: a stack of cards in a corner becomes a run of lines, and there
// is no hover to pause on, so the timer runs and that is all it does.
//
// It never takes focus, which on this host is not a claim but a fact: nothing here is focusable, so
// the renderer cannot put the keys in it. Dismissing is a key rather than a close button, and the key
// is `dismiss` — Escape — answered by the shell, because a toast has nowhere to hold a layer from.

function ToastLine(props: { entry: Toast }) {
  const timer = setTimeout(() => dismissToast(props.entry.id), props.entry.durationMs)
  onCleanup(() => clearTimeout(timer))
  return (
    <Alert tone={props.entry.tone === 'danger' ? 'danger' : props.entry.tone === 'success' ? 'ok' : 'accent'}>
      {props.entry.message}
    </Alert>
  )
}

export function Notifications() {
  return (
    <box flexDirection="column" flexShrink={0}>
      <For each={activeToasts()}>{(entry) => <ToastLine entry={entry} />}</For>
    </box>
  )
}

/** Clear whatever is on screen. The shell's `dismiss` runs this before anything else, so Escape means
 *  "get this out of my way" before it means anything to a pane. */
export const dismissNotifications = (): boolean => {
  const open = activeToasts()
  for (const entry of open) dismissToast(entry.id)
  return open.length > 0
}
