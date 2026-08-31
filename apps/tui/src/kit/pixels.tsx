/** @jsxImportSource @opentui/solid */
import { Show, type JSX } from 'solid-js'
import { HOST, NODE_SUPPORT, type Host, type KitNode } from '@acorn/client-core/kit/tokens/support.ts'
import { Line, slot } from './cells'
import { borderCell } from './roles'
import { EditorRectangle, PtyRectangle, type CellTerminal } from './rectangle'

// The kit's one admission that not everything is a tree, and the two wrappers that let a plugin write
// for a host it has never seen.

/** Four kinds, and this host answers each differently.
 *
 *  `pty` is native and is the thing a terminal does better than the desktop: a real emulator in cells
 *  with the PTY's bytes going straight into it, one tab stop from outside, Enter in, Escape out
 *  (./rectangle.tsx). `editor` is the text of the file, with the `$EDITOR` handoff still to come in
 *  phase 6.
 *
 *  `webview` and `frame` draw their `<Fallback>` child, or a line naming what is missing. Neither
 *  grows: what is inside cannot be drawn, so the box says so on one line and gives the room to the
 *  regions that can use it. A rectangle that fills a pane it cannot fill is a placeholder pretending
 *  to be the thing. */
export function Rectangle(props: {
  kind: 'pty' | 'webview' | 'frame' | 'editor'
  label: string
  mount?: (handle: unknown) => void
  children?: JSX.Element
}) {
  return (
    <Show when={props.kind === 'pty'} fallback={
      <Show when={props.kind === 'editor'} fallback={
        <box
          flexDirection="column"
          flexShrink={0}
          border={borderCell('surface').box}
          borderStyle="single"
          title={props.label}
        >
          {slot(props.children) ?? <Line role="muted">{`${props.label} needs pixels, so it is not drawn here.`}</Line>}
        </box>
      }>
        <EditorRectangle label={props.label}>{slot(props.children)}</EditorRectangle>
      </Show>
    }>
      {/* The caller is handed a terminal rather than an element, which is the whole difference
          between the two hosts here. `mount` is typed `unknown` on this side because the kit's own
          type is the DOM's `HTMLElement`; the caller narrows it, and the rectangle is the one place
          in the kit where a host-specific filler is the point rather than a leak. */}
      <PtyRectangle label={props.label} mount={props.mount as ((terminal: CellTerminal) => void) | undefined} />
    </Show>
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
