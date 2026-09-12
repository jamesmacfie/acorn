import { createEffect, For, Show, on, type JSX } from 'solid-js'

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
}) {
  let scroller: HTMLPreElement | undefined
  // Keyed on the line count rather than the array, because a streaming buffer hands back a new
  // array on every tick and `on()` fires on identity. See docs/ui-design.md § The closed kit.
  createEffect(on(() => props.lines.length, () => {
    if (!props.follow || !scroller) return
    queueMicrotask(() => { if (scroller) scroller.scrollTop = scroller.scrollHeight })
  }))

  return (
    <div class="ui-log">
      <pre ref={scroller} class="ui-log-lines" tabindex={0} role="log" aria-label={props.ariaLabel}>
        <For each={props.lines}>{(line) => <span class="ui-log-line">{line}</span>}</For>
      </pre>
      <Show when={props.find}><div class="ui-log-find">{props.find}</div></Show>
    </div>
  )
}
