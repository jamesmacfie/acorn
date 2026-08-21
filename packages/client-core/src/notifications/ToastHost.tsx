import { createSignal, For, onCleanup } from 'solid-js'
import { activeToasts, dismissToast, type Toast } from './toast'

// The stack. State lives in toast.ts; see the note there on why they are separate files.
export function ToastHost() {
  return (
    <div class="ui-toast-host">
      <For each={activeToasts()}>{(entry) => <ToastRow entry={entry} />}</For>
    </div>
  )
}

function ToastRow(props: { entry: Toast }) {
  const [paused, setPaused] = createSignal(false)
  let remaining = props.entry.durationMs
  let startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined

  const start = () => {
    startedAt = Date.now()
    timer = setTimeout(() => dismissToast(props.entry.id), remaining)
  }
  const stop = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    // Bank the time already served, so hovering pauses rather than restarts.
    remaining = Math.max(0, remaining - (Date.now() - startedAt))
  }

  start()
  onCleanup(stop)

  return (
    <div
      class="ui-toast"
      data-tone={props.entry.tone}
      data-paused={paused() ? '' : undefined}
      // A toast that vanishes while being read is worse than no toast. Hover and keyboard focus both
      // hold it open.
      role={props.entry.tone === 'danger' ? 'alert' : 'status'}
      onPointerEnter={() => { setPaused(true); stop() }}
      onPointerLeave={() => { setPaused(false); start() }}
      onFocusIn={() => { setPaused(true); stop() }}
      onFocusOut={() => { setPaused(false); start() }}
    >
      <span class="ui-toast-message">{props.entry.message}</span>
      <button type="button" class="ui-toast-close" aria-label="Dismiss" onClick={() => dismissToast(props.entry.id)}>✕</button>
    </div>
  )
}
