// The terminal drawer, contributed into the shell's 'drawer' slot (docs/vNext/plan.md § Phase 3, item 1).
//
// App.tsx used to hold a lazy reference to this plugin's TerminalPanel plus the
// `<Show when={termOpen()}>` that decided when to render it. Both moved: the shell now renders a slot host
// and knows nothing about a terminal beyond the `terminalOpen` flag it already tracked per task — which it
// keeps, because the drawer's open/closed state is task state the tab rail and the topbar badge also read.
//
// `when`, not a `<Show>` inside the component: an unrendered contribution never mounts, so xterm is not
// constructed for a closed drawer. The shell's `<Show>` had the same property and losing it would have made
// every task view pay for a terminal it is not showing.
import { lazy } from 'solid-js'
import type { UiSlotContribution } from '@acorn/client-core/registries/slots.ts'

const TerminalPanel = lazy(() => import('./TerminalPanel'))

export const terminalDrawerContribution: UiSlotContribution = {
  id: 'terminal.drawer',
  slot: 'drawer',
  order: 10,
  // Desktop-only, declared rather than probed: the drawer is a PTY surface and there is no engine in a
  // browser (dev:node). The slot host filters on this, so the component never mounts to discover it.
  requires: 'terminal',
  when: (context) => context.terminalOpen,
  // `toggleTerminal`, where the shell passed an explicit `setTerminalOpen(id, false)`. Equivalent here and
  // only here: `when` guarantees this is mounted solely while the drawer is open, so the toggle can only go
  // open → closed. The shell's own close affordances still call it the same way.
  component: (props) => <TerminalPanel task={props.context.activeTask} onClose={props.context.toggleTerminal} />,
}
