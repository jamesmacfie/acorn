import { createSignal, Show } from 'solid-js'
import Icon from '../content/Icon'

// Small copy-to-clipboard button. Hidden by default; a `.copyable` ancestor reveals it on hover
// (see styles/copy.css). Shows a brief check on success.
//
// `onCopy` exists because a sandboxed plugin frame has no `navigator.clipboard`; it copies through
// the bridge instead. That was the documented reason two frames could not use this component at all.
export default function CopyButton(props: {
  /** The text, or an accessor read at click time so a caller can pass a live value such as a ref's
   *  `textContent`. A plugin tree can only send the string: a function crosses the wire under a kit
   *  event name and nothing else (protocol/tree/nodes.ts § KIT_EVENTS). */
  text: string | (() => string)
  onCopy?: (text: string) => void
  title?: string
  /** Draw the button rather than revealing it on a `.copyable` ancestor's hover. For a place with no
   *  such ancestor to hover: a bar of its own, or a plugin tree, which cannot set a class on
   *  anything. */
  always?: boolean
}) {
  const [done, setDone] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const copy = (e: MouseEvent) => {
    e.preventDefault() // don't toggle a parent <details>/<summary>
    e.stopPropagation() // don't trigger a parent row's click
    const text = typeof props.text === 'function' ? props.text() : props.text
    if (props.onCopy) props.onCopy(text)
    else void navigator.clipboard.writeText(text)
    setDone(true)
    clearTimeout(timer)
    timer = setTimeout(() => setDone(false), 1200)
  }
  return (
    <button
      type="button"
      class="copy-btn"
      data-always={props.always ? '' : undefined}
      title={props.title ?? 'Copy'}
      aria-label={props.title ?? 'Copy'}
      onClick={copy}
    >
      <Show when={done()} fallback={<Icon name="copy" size={12} />}>
        <Icon name="check" size={12} />
      </Show>
    </button>
  )
}
