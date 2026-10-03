/** @jsxImportSource @acorn/tui/jsx */
import { createMemo, For, Show, type JSX } from 'solid-js'
import { flatten, Line, Run, slot } from '../cells'
import { markdownLines, type Line as MarkdownLine } from '../markdown'
import { rule } from '../roles'
import { ScrollViewport } from '../scrolling'

/** Monospace lines with a dim rule above and below. Every line in a terminal is monospace, so the
 *  rules are what says "this is a block and not a paragraph". */
export function CodeBlock(props: {
  copy?: boolean | string
  onCopy?: (text: string) => void
  wrap?: boolean
  size?: 'xs' | 'sm'
  maxHeight?: 'none' | 'block'
  children: JSX.Element
}) {
  const RULE = 40
  return (
    <box flexDirection="column">
      <Line role="muted">{rule(RULE)}</Line>
      <For each={flatten(props.children).split('\n')}>
        {(line) => <Line role="mono" wrap={props.wrap}>{line}</Line>}
      </For>
      <Line role="muted">{rule(RULE)}</Line>
    </box>
  )
}

/** Monospace lines with the find bar as the bottom line. `follow` is what the region's scroll does;
 *  the tail is at the bottom because a column of cells grows downward. */
export function Log(props: { lines: readonly string[]; follow?: boolean; find?: JSX.Element; ariaLabel: string }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      {/* A viewport, where this was a yoga clip. A clip owns no offset, so a log longer than its
          frame drew its first screenful and nothing could reach the tail (../scrolling.tsx,
          docs/tui/scrolling.md § Scrolling viewports). The find bar stays outside it, so it is on the bottom
          line wherever the lines above it have been scrolled to. */}
      <ScrollViewport>
        <For each={props.lines}>{(line) => <Line role="mono">{line}</Line>}</For>
      </ScrollViewport>
      {slot(props.find)}
    </box>
  )
}

/** Lines of runs, as the markdown pass produced them. Its own component because provider HTML goes
 *  through the same pass and is drawn the same way (../host.tsx § ProviderHtml). */
export function Lines(props: { lines: MarkdownLine[] }) {
  return (
    // A long document is clipped or scrolled by its region; it must never shrink to the viewport.
    // Without this, yoga takes a height deficit out of every wrapped paragraph and later blocks
    // overwrite the rows it removed — the same invariant as every block in ../grouping.tsx.
    <box flexDirection="column" flexShrink={0}>
      <For each={props.lines}>
        {(line) => (
          <Show when={!line.rule} fallback={<Line role="muted">{rule(40)}</Line>}>
            {/* One `text` with a `span` per run, not a row of `Line`s: a row of text renderables is a
                row of boxes to yoga, and at a width they do not fit each one is shrunk and clips its
                own content — which cut three letters out of every run of a wrapped paragraph
                (../cells.tsx § Run). `width` and `minWidth` make yoga measure the same wrap width
                the text buffer draws; without them it reserves one row for an unwrapped line while
                the buffer paints several, and the next paragraph overwrites those rows. */}
            <box flexDirection="row" flexShrink={0} width="100%" minWidth={0} paddingLeft={line.indent ?? 0}>
              <text wrapMode="word" flexGrow={1} minWidth={0}>
                <For each={line.runs}>{(run) => <Run role={run.role} tone={run.tone}>{run.text}</Run>}</For>
              </text>
            </box>
          </Show>
        )}
      </For>
    </box>
  )
}

/** reduced: no images, and a link is its text with the URL beside it in dim. The policy is the
 *  shell's; this draws what it decided (./markdown.ts). `thumb` is a size, so on a host with no
 *  images it means what the other two mean here: the alt text on a line. */
export function Markdown(props: {
  text: string
  images?: 'inline' | 'placeholder' | 'thumb'
  copy?: boolean
  onCopy?: (text: string) => void
  onSelect?: (href: string) => void
}) {
  const lines = createMemo(() => markdownLines(props.text))
  return <Lines lines={lines()} />
}

