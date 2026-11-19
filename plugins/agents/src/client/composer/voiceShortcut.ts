import { registerCommands, registerKeybindings } from '@acorn/plugin-api/client'

// The dictation shortcut. Command ids are unique, so it is registered once, while any composer that
// can dictate is mounted, and a press goes to the composer holding focus. With one composer on screen
// it goes there, focused or not.

type Listener = { owns(element: Element | null): boolean; press(): void }

const listeners = new Set<Listener>()
let registration: { dispose(): void } | undefined

const COMMAND = 'agents.composer.dictate'
export const DICTATE_CHORD = 'meta+shift+l'

function press() {
  const all = [...listeners]
  const target =
    all.find((listener) => listener.owns(document.activeElement)) ?? (all.length === 1 ? all[0] : undefined)
  target?.press()
}

/** Listen for the shortcut until the returned function runs. */
export function listenForDictation(listener: Listener): () => void {
  listeners.add(listener)
  if (!registration) {
    const commands = registerCommands([
      { id: COMMAND, title: 'Dictate to the agent', category: 'action', palette: true, scope: 'task', run: press },
    ])
    const bindings = registerKeybindings([
      {
        id: COMMAND,
        command: COMMAND,
        description: 'Hold to dictate, or tap to keep listening',
        category: 'Agents',
        defaultChord: DICTATE_CHORD,
        // Not `typing-exempt`: it has to work from inside the message box.
        when: 'task',
      },
    ])
    registration = {
      dispose: () => {
        bindings.dispose()
        commands.dispose()
      },
    }
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    registration?.dispose()
    registration = undefined
  }
}
