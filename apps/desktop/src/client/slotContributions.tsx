import { lazy } from 'solid-js'
import type { UiSlotContribution } from '@acorn/client-core/host/registries/extensionPoints/uiSlots.tsx'

const NotificationBell = lazy(() => import('@acorn/client-core/features/notifications/NotificationBell.tsx'))
const CommandPalette = lazy(() => import('@acorn/client-core/host/palette/CommandPalette.tsx'))
const WorkspacePalette = lazy(() => import('@acorn/client-core/host/palette/WorkspacePalette.tsx'))
const ConfigTrustDialog = lazy(() => import('@acorn/client-core/features/settings/trust/ConfigTrustDialog.tsx'))
const PluginTrustDialog = lazy(() => import('@acorn/client-core/host/trust/PluginTrustDialog.tsx'))
const PluginApprovalDialog = lazy(() => import('@acorn/client-core/host/trust/PluginApprovalDialog.tsx'))

export const shellSlotContributions: UiSlotContribution[] = [
  { id: 'security.config-trust', slot: 'overlay', order: 5, component: () => <ConfigTrustDialog /> },
  // Just behind config-trust: both are consent gates, and a task waiting on a config prompt is a
  // thing the owner asked for, while a plugin prompt arrives on its own at boot.
  { id: 'security.plugin-trust', slot: 'overlay', order: 6, component: () => <PluginTrustDialog /> },
  // Ahead of both, because it is the only one the owner opened themselves: the other two arrive on their
  // own, and this one is the answer to a notification they just clicked.
  { id: 'security.plugin-approval', slot: 'overlay', order: 4, component: () => <PluginApprovalDialog /> },
  {
    id: 'notifications.bell', slot: 'topbar.right', order: 10,
    component: (props) => <NotificationBell onSelectTask={props.context.selectTask} />,
  },
  { id: 'palette.commands', slot: 'overlay', order: 10, component: () => <CommandPalette /> },
  { id: 'palette.workspaces', slot: 'overlay', order: 30, component: () => <WorkspacePalette /> },
]
