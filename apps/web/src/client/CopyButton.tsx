import { createSignal, Show } from 'solid-js'

// Small copy-to-clipboard button. Hidden by default; a `.copyable` ancestor reveals it on hover
// (see styles/copy.css). `text` is read lazily on click so callers can pass live accessors
// (e.g. a ref's textContent). Shows a brief check on success.
export default function CopyButton(props: { text: () => string; title?: string; class?: string }) {
  const [done, setDone] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const copy = (e: MouseEvent) => {
    e.preventDefault() // don't toggle a parent <details>/<summary>
    e.stopPropagation() // don't trigger a parent row's click
    void navigator.clipboard.writeText(props.text())
    setDone(true)
    clearTimeout(timer)
    timer = setTimeout(() => setDone(false), 1200)
  }
  return (
    <button type="button" class={`copy-btn ${props.class ?? ''}`} title={props.title ?? 'Copy'} aria-label={props.title ?? 'Copy'} onClick={copy}>
      <Show
        when={done()}
        fallback={
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        }
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </Show>
    </button>
  )
}
