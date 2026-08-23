import { lazy } from 'solid-js'
import type { UiSlotContribution } from '@acorn/plugin-api/client'

const TerminalPanel = lazy(() => import('./TerminalPanel'))

export const terminalDrawerContribution: UiSlotContribution = {
  id: 'terminal.drawer',
  slot: 'drawer',
  order: 10,
  // Desktop-only, declared rather than probed: the drawer is a PTY surface and there is no engine in a
  // browser (dev:node). The slot host filters on this, so the component never mounts to discover it.
  requires: 'terminal',
  when: (context) => context.terminalOpen,
  // `closeTerminal`, not `toggleTerminal`. TerminalPanel.closeTab decides to close the drawer after two
  // awaits, so closing the last two tabs in quick succession fires `onClose` twice. A toggle would
  // close the drawer and then reopen it empty, where onMount auto-launches the rail's default profile
  // and leaves a stray PTY behind. The idempotent guard lives on the slot context, with the state.
  component: (props) => <TerminalPanel task={props.context.activeTask} onClose={props.context.closeTerminal} />,
}
