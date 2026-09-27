import { onCleanup } from 'solid-js'
import { registerCommands } from '@acorn/plugin-api/client'
import { registerKeybindings } from '@acorn/plugin-api/ui/host'

/** Keyboard access to the in-field size toggle omitted from the terminal. */
export default function TerminalComposerShortcut(props: { toggle: () => void }) {
  const commands = registerCommands([{
    id: 'agents.composer.expand', title: 'Expand or collapse the agent message box',
    category: 'action', palette: true, scope: 'task', run: props.toggle,
  }])
  const bindings = registerKeybindings([{
    id: 'agents.composer.expand', command: 'agents.composer.expand',
    description: 'Expand or collapse the message box', category: 'Agents',
    defaultChord: 'alt+e', when: 'typing-exempt',
  }])
  onCleanup(() => { bindings.dispose(); commands.dispose() })
  return null
}
