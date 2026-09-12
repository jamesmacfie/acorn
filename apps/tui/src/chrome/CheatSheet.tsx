/** @jsxImportSource @acorn/tui/jsx */
import { For } from 'solid-js'
import { Modal, ModalBody } from '../kit/grouping'
import { Kbd } from '../kit/showing'
import { Line } from '../kit/cells'
import { pad } from '../kit/cells'
import { activeHints } from './bindings'
import { closeOverlay } from './state'

// What the keyboard will do right here, in full.
//
// The same list the footer draws and the same reason `client-core/host/keys/CheatSheet.tsx` gives for
// reading the keymap rather than the registry: the question is "what will this key do now", not "what
// is registered somewhere". Snapshotted on open, because the modal itself changes what is active the
// moment it takes the keys.
export function CheatSheet() {
  const rows = activeHints()
  const width = Math.max(0, ...rows.map((row) => row.keys.length))

  return (
    <Modal onDismiss={() => closeOverlay('help')} title="Keys" size="md">
      <ModalBody>
        <For each={rows} fallback={<Line role="muted">Nothing is bound here.</Line>}>
          {(row) => (
            <box flexDirection="row" gap={2}>
              <Kbd>{pad(row.keys, width)}</Kbd>
              <Line>{row.label}</Line>
              <Line role="muted">{row.detail ?? ''}</Line>
            </box>
          )}
        </For>
      </ModalBody>
    </Modal>
  )
}
