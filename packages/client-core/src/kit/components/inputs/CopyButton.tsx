import { createSignal } from 'solid-js'
import Icon from '../content/Icon'

// Small copy-to-clipboard button. Hidden by default; a `.copyable` ancestor reveals it on hover
// (see the CopyButton block in primitives.css). Shows a brief check on success.
//
// `onCopy` exists because a sandboxed plugin frame has no `navigator.clipboard`; it copies through
// the bridge instead.
export default function CopyButton(props: {
  /** The text, or an accessor read at click time so a caller can pass a live value such as a ref's
   *  `textContent`. A plugin tree can only send the string: a function crosses the wire under a kit
   *  event name and nothing else (`KIT_EVENTS`). */
  text: string | (() => string)
  onCopy?: (text: string) => void
  title?: string
  /** The tip's second line, such as the text it copies. */
  tipSub?: string
  /** Draw the button rather than revealing it on a `.copyable` ancestor's hover. For a place with no
   *  such ancestor to hover: a bar of its own, or a plugin tree, which cannot set a class on
   *  anything. */
  always?: boolean
  /** Draws it as an `IconButton` of this size, always shown, for a place beside other icon buttons. */
  size?: 'xs' | 'sm' | 'md'
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
  const label = () => props.title ?? 'Copy'
  // A sized button carries the attributes IconButton's rules key on, so it takes IconButton's look.
  const sized = () => props.size !== undefined
  return (
    <button
      type="button"
      class={sized() ? 'copy-btn ui-btn' : 'copy-btn'}
      data-variant={sized() ? 'bare' : undefined}
      data-size={props.size}
      data-icon-only={sized() ? '' : undefined}
      data-always={props.always || sized() ? '' : undefined}
      data-tip={label()}
      data-tip-sub={props.tipSub}
      aria-label={label()}
      onClick={copy}
    >
      <Icon name={done() ? 'check' : 'copy'} size={sized() ? undefined : 12} />
    </button>
  )
}
