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
  // `closeTerminal`, not `toggleTerminal`. This was `toggleTerminal` with a comment arguing the two were
  // equivalent because `when` guarantees the drawer is open while this is mounted, so a toggle could only go
  // open → closed. That argument does not survive TerminalPanel.closeTab, which decides to close the drawer
  // AFTER two awaits (`await api.remove(id)` then `await refreshSessions()`): close the last two tabs in quick
  // succession and both continuations see an empty roster, so `onClose` fires twice. The first toggle closes
  // the drawer, the second reopens it — into an empty drawer, where onMount auto-launches the rail's default
  // profile. A stray PTY, from closing a tab.
  //
  // An idempotent `closeTerminal` on the slot context rather than a `props.context.terminalOpen` check here:
  // the guard belongs with the state, the shell already had the mirror form for its open affordance, and
  // "close" is what this call site actually means.
  component: (props) => <TerminalPanel task={props.context.activeTask} onClose={props.context.closeTerminal} />,
}
