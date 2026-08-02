import { createSignal, Show } from 'solid-js'
import Icon from './Icon'

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
      <Show when={done()} fallback={<Icon name="copy" size={12} />}>
        <Icon name="check" size={12} />
      </Show>
    </button>
  )
}
