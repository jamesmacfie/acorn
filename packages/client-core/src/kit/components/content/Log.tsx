import { createEffect, For, Show, on, type JSX } from 'solid-js'
import { retainScroll } from '../../lib/layout/retainScroll'

/* Log: a monospace tail. docker wrote this as a `<pre>` with its own follow logic and its own find
   bar, and it is the shape every streaming output takes.

   Not CodeBlock, which is a fixed excerpt: this one grows at the bottom and has somewhere to be.
   Not a Rectangle either — the lines are text, and a terminal draws them better than the DOM does.

   At 80×24: monospace lines, the find bar as the bottom line. */
export function Log(props: {
  lines: readonly string[]
  /** Stick to the bottom as lines arrive. The caller owns the toggle; this only obeys it. */
  follow?: boolean
  /** The bottom strip: a FindBar, a stream-state note, a clear button. */
  find?: JSX.Element
  ariaLabel: string
  /** The reader's position when Follow is off, retained by the caller across mounts. */
  scrollOffset?: number
  onChange?: (offset: number) => void
}) {
  let scroller: HTMLPreElement | undefined
  // Keyed on the line count rather than the array, because a streaming buffer hands back a new
  // array on every tick and `on()` fires on identity. See docs/ui-design/closed-kit.md § The closed kit.
  createEffect(on(() => [props.lines.length, props.follow] as const, () => {
    if (!props.follow || !scroller) return
    queueMicrotask(() => { if (props.follow && scroller) scroller.scrollTop = scroller.scrollHeight })
  }))

  return (
    <div class="ui-log">
      <pre ref={(element) => {
        scroller = element
        retainScroll(element, {
          key: () => props.ariaLabel,
          read: () => props.follow ? Math.max(0, element.scrollHeight - element.clientHeight) : props.scrollOffset ?? 0,
          write: (_, offset) => props.onChange?.(offset),
        })
      }} class="ui-log-lines" tabindex={0} role="log" aria-label={props.ariaLabel}>
        <For each={props.lines}>{(line) => <span class="ui-log-line">{line}</span>}</For>
      </pre>
      <Show when={props.find}><div class="ui-log-find">{props.find}</div></Show>
    </div>
  )
}
