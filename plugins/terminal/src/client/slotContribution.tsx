// The topbar terminal-drawer toggle, contributed into the shell's `topbar.right` slot.
//
// A .tsx sibling because the button is inline JSX bound to three shell callbacks from the slot context
// (open state, toggle, and whether a task is active at all). Moved verbatim out of
// apps/desktop/src/app/client/slotContributions.tsx — the shell contributed the toggle for the drawer
// this plugin owns, which is the wrong way round.
import type { UiSlotContribution } from '@acorn/client-core/registries/uiSlots.tsx'

export const terminalToggleSlotContribution: UiSlotContribution = {
  id: 'terminal.topbar-toggle',
  slot: 'topbar.right',
  order: 20,
  // The drawer needs the main-process PTY engine, and there is nothing to toggle without a task.
  requires: 'desktop',
  when: (context) => context.taskActive,
  component: (props) => (
    <button type="button" class="theme-toggle" title="Terminal" aria-pressed={props.context.terminalOpen} onClick={props.context.toggleTerminal}>▣</button>
  ),
}
