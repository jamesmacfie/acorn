import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { registerCommands } from '../registries/commands/commands'
import { registerKeybindings } from '../registries/commands/keybindings'
import { Button, Kbd, Table, TableCell, TableRow } from '../../kit/components/primitives'
import { Section } from '../../kit/components/layout/Section'
import { formatChord } from '../../kit/lib/rendering/formatChord'
import { Modal } from '../../kit/components/overlays/Modal'
import { keymap } from '../../kit/keys/keymapHost'

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
type Group = { name: string; lines: Line[] }

// One section per owner, named as the owner registered it, in the app's own chord notation.
const groups = (): Group[] => {
  const engine = keymap()
  if (!engine) return []
  const lines = engine.getActiveKeys({ includeMetadata: true })
    .map((key): Line => ({
      display: formatChord(engine.formatKey(key.display, { separator: ' ' })),
      group: String(key.commandAttrs?.group ?? key.bindingAttrs?.group ?? 'Other'),
      desc: String(key.bindingAttrs?.desc ?? key.commandAttrs?.desc ?? ''),
    }))
    .filter((line) => line.desc)
    .sort((a, b) => a.group.localeCompare(b.group) || a.desc.localeCompare(b.desc))
  const byName = new Map<string, Line[]>()
  for (const line of lines) byName.set(line.group, [...(byName.get(line.group) ?? []), line])
  return [...byName].map(([name, entries]) => ({ name, lines: entries }))
}

export function CheatSheet() {
  const [open, setOpen] = createSignal(false)
  // Snapshotted on open, because the modal itself changes what is active the moment it takes focus.
  const [sections, setSections] = createSignal<Group[]>([])

  onMount(() => {
    const commands = registerCommands([{
      id: 'core.shortcuts.cheat-sheet',
      title: 'Show keyboard shortcuts',
      hint: 'what the keyboard does right here',
      category: 'navigation',
      palette: true,
      run: () => { setSections(groups()); setOpen(true) },
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
          <For each={sections()}>
            {(group) => (
              <Section label={group.name}>
                <Table size="sm">
                  <For each={group.lines}>
                    {(line) => (
                      // What it does first and the key at the end, as a menu shows them. With the key
                      // first, each section's table sized its own key column and the descriptions
                      // started at a different edge in every section.
                      <TableRow>
                        <TableCell>{line.desc}</TableCell>
                        <TableCell align="end"><Kbd>{line.display}</Kbd></TableCell>
                      </TableRow>
                    )}
                  </For>
                </Table>
              </Section>
            )}
          </For>
        </Modal.Body>
        <Modal.Actions>
          <Button variant="ghost" onPress={() => setOpen(false)}>Close</Button>
        </Modal.Actions>
      </Modal>
    </Show>
  )
}
