import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { registerCommands } from '../registries/commands'
import { registerKeybindings } from '../registries/keybindings'
import { Kbd, Table } from '../ui/primitives'
import { Modal } from '../ui/Modal'
import { keymap } from './host'

// The cheat sheet: what the keyboard will do right now.
//
// Read from the keymap's own catalog rather than from the keybinding registry, and the difference is
// the whole point: `getActiveKeys` answers for the layers that are active against the element that
// has focus, so a chord a pane shadows shows the pane's meaning, and one whose command is
// unavailable does not show at all. A list built from the registry would say what is registered,
// which is not the question anyone is asking with a cheat sheet open.
//
// Textual draws the same data as a footer strip; a terminal host would read this function too.

type Line = { display: string; group: string; desc: string }

const lines = (): Line[] => {
  const engine = keymap()
  if (!engine) return []
  return engine.getActiveKeys({ includeMetadata: true })
    .map((key): Line => ({
      display: engine.formatKey(key.display, { separator: ' ' }),
      group: String(key.commandAttrs?.group ?? key.bindingAttrs?.group ?? 'Other'),
      desc: String(key.bindingAttrs?.desc ?? key.commandAttrs?.desc ?? ''),
    }))
    .filter((line) => line.desc)
    .sort((a, b) => a.group.localeCompare(b.group) || a.desc.localeCompare(b.desc))
}

export function CheatSheet() {
  const [open, setOpen] = createSignal(false)
  // Snapshotted on open, because the modal itself changes what is active the moment it takes focus.
  const [rows, setRows] = createSignal<Line[]>([])

  onMount(() => {
    const commands = registerCommands([{
      id: 'core.shortcuts.cheat-sheet',
      title: 'Show keyboard shortcuts',
      hint: 'what the keyboard does right here',
      category: 'navigation',
      palette: true,
      run: () => { setRows(lines()); setOpen(true) },
    }])
    const bindings = registerKeybindings([{
      id: 'core.shortcuts.cheat-sheet',
      command: 'core.shortcuts.cheat-sheet',
      description: 'Show keyboard shortcuts',
      category: 'Global',
      defaultChord: 'meta+/',
      when: 'global',
    }])
    onCleanup(() => { bindings.dispose(); commands.dispose() })
  })

  return (
    <Show when={open()}>
      <Modal title="Keyboard shortcuts" size="md" onDismiss={() => setOpen(false)}>
        <Modal.Body>
          <Table size="sm">
            <tbody>
              <For each={rows()}>
                {(line) => (
                  <tr>
                    <td><Kbd>{line.display}</Kbd></td>
                    <td>{line.desc}</td>
                    <td class="muted">{line.group}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </Table>
        </Modal.Body>
      </Modal>
    </Show>
  )
}
