/** @jsxImportSource @opentui/solid */
import { Show, type JSX } from 'solid-js'
import { HOST, NODE_SUPPORT, type Host, type KitNode } from '@acorn/client-core/kit/tokens/support.ts'
import { Line, slot } from './cells'
import { borderCell } from './roles'

// The kit's one admission that not everything is a tree, and the two wrappers that let a plugin write
// for a host it has never seen.

/** Four kinds, and this host answers each differently.
 *
 *  `pty` and `editor` are native: the TUI draws a terminal inside a terminal with a real PTY on a real
 *  cell region, and an editor as the text of the file with a handoff to `$EDITOR` beside it. Both are
 *  phase 2's, because a rectangle is defined by its keys — one tab stop from outside, Enter in,
 *  Escape out — and focus without a DOM is that phase. Until then the box is drawn with its label and
 *  says what it is waiting for, which is honest and is not the placeholder a refused node gets.
 *
 *  `webview` and `frame` draw their `<Fallback>` child, or a line naming what is missing. */
export function Rectangle(props: {
  kind: 'pty' | 'webview' | 'frame' | 'editor'
  label: string
  mount?: (element: unknown) => void
  children?: JSX.Element
}) {
  const native = () => props.kind === 'pty' || props.kind === 'editor'
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      border={borderCell('surface').box}
      borderStyle="single"
      title={props.label}
    >
      <Show
        when={native()}
        fallback={slot(props.children) ?? <Line role="muted">{`${props.label} needs pixels, so it is not drawn here.`}</Line>}
      >
        <Line role="muted">{props.kind === 'pty' ? 'the terminal attaches here' : 'the file opens here'}</Line>
        {slot(props.children)}
      </Show>
    </box>
  )
}

/** Children exist on the named hosts and nowhere else; no fallback wanted. Written here rather than
 *  imported so this package's table is its own, but it reads the same `HOST` and the same matrix, so
 *  the two hosts cannot disagree about what a node's level is. */
export function Only(props: { hosts: readonly Host[]; children: JSX.Element }) {
  return <Show when={props.hosts.includes(HOST)}>{props.children}</Show>
}

/** What to draw where the matrix says this host cannot draw the node it is inside. */
export function Fallback(props: { forNode: KitNode; children: JSX.Element }) {
  const short = () => {
    const level = NODE_SUPPORT[props.forNode][HOST]
    return level === 'fallback' || level === 'absent'
  }
  return <Show when={short()}>{props.children}</Show>
}
