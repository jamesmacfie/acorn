// The pull-file palette (⌘⇧P), contributed into the shell's overlay slot.
//
// A .tsx sibling rather than a line in index.ts because this is the one shell slot whose component
// needs a prop wired from the slot CONTEXT — "open the shortcuts settings page" — and a JSX wrapper is
// how a slot adapts a component to the host's props contract.
import { lazy } from 'solid-js'
import type { UiSlotContribution } from '@acorn/client-core/registries/uiSlots.tsx'

const Shortcuts = lazy(() => import('./Shortcuts'))

export const pullFilePaletteSlotContribution: UiSlotContribution = {
  id: 'palette.pull-files',
  slot: 'overlay',
  order: 40,
  component: (props) => <Shortcuts onOpenShortcuts={() => props.context.openSettings('shortcuts')} />,
}
