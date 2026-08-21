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
  // `closeTerminal`, not `toggleTerminal`. This was `toggleTerminal` with a comment arguing the two
  // were equivalent because `when` guarantees the drawer is open while this is mounted, so a toggle
  // could only go open to closed. That argument does not survive TerminalPanel.closeTab, which
  // decides to close the drawer after two awaits (`await api.remove(id)` then `await
  // refreshSessions()`). Close the last two tabs in quick succession and both continuations see an
  // empty roster, so `onClose` fires twice: the first toggle closes the drawer, the second reopens it
  // into an empty drawer, where onMount auto-launches the rail's default profile. A stray PTY, from
  // closing a tab.
  //
  // An idempotent `closeTerminal` on the slot context, rather than a `props.context.terminalOpen`
  // check here: the guard belongs with the state, the shell already had the mirror form for its open
  // affordance, and "close" is what this call site actually means.
  component: (props) => <TerminalPanel task={props.context.activeTask} onClose={props.context.closeTerminal} />,
}
