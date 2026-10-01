import { onCleanup } from 'solid-js'
import { registerCommands } from '@acorn/plugin-api/client'
import { registerKeybindings } from '@acorn/plugin-api/ui/host'

/** The transcript actions whose desktop buttons take too many terminal rows. */
export default function TerminalConversationShortcuts(props: {
  top: () => void
  bottom: () => void
  toggleChats: () => void
  collapseTools: () => void
}) {
  const commands = registerCommands([
    { id: 'agents.transcript.top', title: 'Scroll to the top of the agent transcript', category: 'navigation', palette: true, scope: 'task', run: props.top },
    { id: 'agents.transcript.bottom', title: 'Scroll to the bottom of the agent transcript', category: 'navigation', palette: true, scope: 'task', run: props.bottom },
    { id: 'agents.transcript.chats', title: 'Show only agent and user messages', category: 'action', palette: true, scope: 'task', run: props.toggleChats },
    { id: 'agents.transcript.collapse', title: 'Collapse every agent tool card', category: 'action', palette: true, scope: 'task', run: props.collapseTools },
  ])
  const bindings = registerKeybindings([
    { id: 'agents.transcript.top', command: 'agents.transcript.top', description: 'Transcript top', category: 'Agents', defaultChord: 'alt+u', when: 'typing-exempt' },
    { id: 'agents.transcript.bottom', command: 'agents.transcript.bottom', description: 'Transcript bottom', category: 'Agents', defaultChord: 'alt+d', when: 'typing-exempt' },
    { id: 'agents.transcript.chats', command: 'agents.transcript.chats', description: 'Messages only', category: 'Agents', defaultChord: 'alt+m', when: 'typing-exempt' },
    { id: 'agents.transcript.collapse', command: 'agents.transcript.collapse', description: 'Collapse tool cards', category: 'Agents', defaultChord: 'alt+c', when: 'typing-exempt' },
  ])
  onCleanup(() => { bindings.dispose(); commands.dispose() })
  return null
}
