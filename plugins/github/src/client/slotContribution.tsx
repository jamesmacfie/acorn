// This plugin's router-scoped commands and global shortcuts, contributed into the shell's overlay slot.
//
// It draws nothing: the slot is how a registration that needs the router gets mounted at all, and the
// file finder that used to draw here is a command on the shared session now (./Shortcuts.tsx).
//
// A .tsx sibling rather than a line in index.ts because this is the one shell slot whose component
// needs a prop wired from the slot context ("open the shortcuts settings page"), and a JSX wrapper is
// how a slot adapts a component to the host's props contract.
import { lazy } from 'solid-js'
import type { UiSlotContribution } from '@acorn/plugin-api/client'

const Shortcuts = lazy(() => import('./Shortcuts'))

export const githubShortcutsSlotContribution: UiSlotContribution = {
  id: 'github.shortcuts',
  slot: 'overlay',
  order: 40,
  component: (props) => <Shortcuts onOpenShortcuts={() => props.context.openSettings('shortcuts')} />,
}
