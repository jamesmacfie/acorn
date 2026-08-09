import { lazy } from 'solid-js'
import type { UiSlotContribution } from '@acorn/client-core/registries/uiSlots.tsx'

const NotificationBell = lazy(() => import('@acorn/client-core/notifications/NotificationBell.tsx'))
const CommandPalette = lazy(() => import('./CommandPalette'))
const WorkspacePalette = lazy(() => import('@acorn/client-core/palette/WorkspacePalette.tsx'))
const ConfigTrustDialog = lazy(() => import('@acorn/client-core/configTrust/ConfigTrustDialog.tsx'))
const PluginTrustDialog = lazy(() => import('@acorn/client-core/plugins/PluginTrustDialog.tsx'))

export const shellSlotContributions: UiSlotContribution[] = [
  { id: 'security.config-trust', slot: 'overlay', order: 5, component: () => <ConfigTrustDialog /> },
  // Just behind config-trust: both are consent gates, and a task waiting on a config prompt is a
  // thing the owner asked for, while a plugin prompt arrives on its own at boot.
  { id: 'security.plugin-trust', slot: 'overlay', order: 6, component: () => <PluginTrustDialog /> },
  {
    id: 'notifications.bell', slot: 'topbar.right', order: 10,
    component: (props) => <NotificationBell onSelectTask={props.context.selectTask} />,
  },
  { id: 'palette.commands', slot: 'overlay', order: 10, component: () => <CommandPalette /> },
  { id: 'palette.workspaces', slot: 'overlay', order: 30, component: () => <WorkspacePalette /> },
]
