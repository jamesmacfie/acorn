/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, Show } from 'solid-js'
import type { Renderable } from '../tree/compat'
import { nodeState } from '@acorn/client-core/infra/node/fleet.ts'
import { Line, ellipsise } from '../kit/cells'
import { enteredRectangle } from '../kit/rectangle'
import { activeHints } from './bindings'
import { nodeSentence, nodeStarting } from './nodeState'

// The last line: what the keyboard will do, and what the node is doing.
//
// Textual renders active bindings as a footer strip and it is the right answer for a host with no
// hover and no menu bar: the only way to learn a key is to be shown it. The list is
// `./bindings.ts`, which reads the keymap's own active layers, so the footer cannot claim a key that
// is not bound and cannot miss one that is.
//
// The node's state takes the right-hand end, and only when it is worth a sentence. A healthy node
// says nothing, which is the same rule every other surface in the app keeps
// (docs/ui-design.md § Connection and staleness vocabulary).

/** What an entered rectangle says instead of the hints, because while it is entered they are all
 *  false: it has taken every key, and the only two that mean anything are these
 *  (../kit/rectangle.tsx § The Rectangle contract). */
const ENTERED = 'esc leave · esc esc send escape'

export function Footer(props: { nodeId: string }) {
  let box: Renderable | undefined
  const [width, setWidth] = createSignal(80)
  const state = () => nodeState(props.nodeId)
  const sentence = () => nodeSentence(state())

  const hints = (): string => {
    if (enteredRectangle()) return ENTERED
    const line = activeHints().map((hint) => `${hint.keys} ${hint.label}`).join(' · ')
    // Cut rather than wrap. A footer that grows to two lines takes a line off the pane, and the
    // hints are already in reading order: what is cut is what mattered least.
    return ellipsise(line, Math.max(0, width() - (sentence()?.length ?? 0) - 2))
  }

  return (
    <box
      flexDirection="row"
      gap={1}
      flexShrink={0}
      ref={(element: Renderable) => { box = element; setWidth(element.width) }}
      onSizeChange={() => setWidth(box?.width ?? 80)}
    >
      <Line role="muted">{hints()}</Line>
      <box flexGrow={1} />
      <Show when={sentence()}>
        {/* A node still booting is not a fault, so it is not drawn as one: the same amber a reconnect
            gets, because both are "wait a moment" (./nodeState.ts). */}
        {(text) => <Line tone={nodeStarting() || state() === 'degraded' ? 'warn' : 'danger'}>{text()}</Line>}
      </Show>
    </box>
  )
}
