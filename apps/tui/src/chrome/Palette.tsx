/** @jsxImportSource @opentui/solid */
import { createMemo, For, Show } from 'solid-js'
import type { CommandSession } from '@acorn/client-core/host/registries/commands/session.ts'
import { Modal, ModalBody } from '../kit/grouping'
import { Alert, Row } from '../kit/showing'
import { Input } from '../kit/asking'
import { Line } from '../kit/cells'
import { overlayKeys } from '../keys/trap'

// The command palette, over the same session the desktop's runs on.
//
// This file used to hold a copy of the desktop's palette: the same resource over every contributed row
// source, the same composition with the actions and the task and workspace lists, the same fuzzy
// filter, the same row-to-source map, the same invoke. All of it is
// `client-core/host/registries/commands/session.ts` now, which is where the two hosts were always
// going to have to agree — a group that pushed here and not there would be two products.
//
// What stays is the rectangle. There is no backdrop and no dialog: the surface is a `Modal` holding a
// filter field and a list, which is what a terminal overlay is (docs/tui.md § What is drawn bespoke).
//
// Nor does the cursor come from the kit's collection, and that is the same decision the desktop made
// for the same reason: a palette is a text box you steer with the arrows, and a collection's keys are
// bare keys, which do not fire while something is being typed into — which in a palette is always. So
// the arrows are a layer above the trap (../keys/trap.ts § overlayKeys) and the session owns the
// cursor they move.

/** How many rows fit under the field. Fixed rather than measured: the modal is drawn where the pane
 *  is and the pane is at least this tall at 80 by 24, which is the size the kit promises. */
const VISIBLE = 12

export function Palette(props: { session: CommandSession }) {
  const rows = () => props.session.rows()

  // The window follows the cursor rather than a scroll position, the same rule `Rows` keeps: there is
  // no pointer to scroll with, so the keys move the cursor and the view goes where the cursor is.
  const window = createMemo(() => {
    const all = rows()
    const at = props.session.selectedIndex()
    if (all.length <= VISIBLE) return { from: 0, rows: all }
    const from = Math.min(Math.max(0, at - Math.floor(VISIBLE / 2)), all.length - VISIBLE)
    return { from, rows: all.slice(from, from + VISIBLE) }
  })

  overlayKeys([
    { key: 'down', cmd: () => { props.session.move(1); return true } },
    { key: 'up', cmd: () => { props.session.move(-1); return true } },
    { key: 'return', cmd: () => { props.session.activate(); return true } },
  ])

  return (
    // Escape is the single way back: it pops a frame, and at the root it closes and the shell takes
    // the keys again (../keys/trap.ts).
    <Modal onDismiss={() => props.session.back()} title="Commands" size="wide">
      <ModalBody>
        <Show when={props.session.breadcrumb().length}>
          <Line role="muted">{props.session.breadcrumb().join(' › ')}</Line>
        </Show>
        <box flexDirection="column">
          <Input
            kind="filter"
            // A search or an input frame asks for its own thing; the root and a group are still the list.
            placeholder={props.session.placeholder() || 'Run a command, switch a pane, task or workspace…'}
            value={props.session.query()}
            onInput={(value) => props.session.setQuery(value)}
          />
        </box>
        <Show when={props.session.status()}><Alert>{props.session.status()}</Alert></Show>
        <For
          each={window().rows}
          fallback={<Line role="muted">{props.session.busy() ? 'Loading…' : 'No matches.'}</Line>}
        >
          {(row, index) => (
            <Row
              selected={window().from + index() === props.session.selectedIndex()}
              leading={window().from + index() === props.session.selectedIndex() ? '›' : ' '}
              meta={[row.badge, row.breadcrumb?.join(' › '), row.hint].filter(Boolean).join(' · ')}
            >
              {row.label}
            </Row>
          )}
        </For>
      </ModalBody>
    </Modal>
  )
}
