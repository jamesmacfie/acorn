import { lazy } from 'solid-js'
import type { UiSlotContribution } from '@acorn/client-core/registries/uiSlots.tsx'

// CORE's shell slots, and only core's. Three plugin-owned slots that used to sit in this list are now
// declared by their plugins: terminal's topbar drawer toggle (topbar.right 20), editor's file palette
// (overlay 20) and github's pull-file palette (overlay 40). Slots sort by `order` within a slot, so
// splitting the list does not change what renders where.
//
// CommandPalette stays: it is the SHELL's palette, and it reaches into terminal recipes and workflow
// clients directly (Phase 3's third coupling-table row).
const NotificationBell = lazy(() => import('@acorn/client-core/notifications/NotificationBell.tsx'))
const CommandPalette = lazy(() => import('./CommandPalette'))
const WorkspacePalette = lazy(() => import('@acorn/client-core/palette/WorkspacePalette.tsx'))
const ConfigTrustDialog = lazy(() => import('@acorn/client-core/configTrust/ConfigTrustDialog.tsx'))

export const shellSlotContributions: UiSlotContribution[] = [
  { id: 'security.config-trust', slot: 'overlay', order: 5, component: () => <ConfigTrustDialog /> },
  {
    id: 'notifications.bell', slot: 'topbar.right', order: 10,
    component: (props) => <NotificationBell onSelectTask={props.context.selectTask} />,
  },
  { id: 'palette.commands', slot: 'overlay', order: 10, component: () => <CommandPalette /> },
  { id: 'palette.workspaces', slot: 'overlay', order: 30, component: () => <WorkspacePalette /> },
]
