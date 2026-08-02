import { lazy } from 'solid-js'
import type { UiSlotContribution } from '@acorn/client-core/registries/uiSlots.tsx'

const NotificationBell = lazy(() => import('@acorn/client-core/notifications/NotificationBell.tsx'))
const CommandPalette = lazy(() => import('./CommandPalette'))
const FilePalette = lazy(() => import('@acorn/plugin-editor/client/FilePalette.tsx'))
const WorkspacePalette = lazy(() => import('@acorn/client-core/palette/WorkspacePalette.tsx'))
const Shortcuts = lazy(() => import('@acorn/plugin-github/client/Shortcuts.tsx'))
const ConfigTrustDialog = lazy(() => import('@acorn/client-core/configTrust/ConfigTrustDialog.tsx'))

export const shellSlotContributions: UiSlotContribution[] = [
  { id: 'security.config-trust', slot: 'overlay', order: 5, component: () => <ConfigTrustDialog /> },
  {
    id: 'notifications.bell', slot: 'topbar.right', order: 10,
    component: (props) => <NotificationBell onSelectTask={props.context.selectTask} />,
  },
  {
    id: 'terminal.topbar-toggle', slot: 'topbar.right', order: 20, requires: 'desktop',
    when: (context) => context.taskActive,
    component: (props) => (
      <button type="button" class="theme-toggle" title="Terminal" aria-pressed={props.context.terminalOpen} onClick={props.context.toggleTerminal}>▣</button>
    ),
  },
  { id: 'palette.commands', slot: 'overlay', order: 10, component: () => <CommandPalette /> },
  { id: 'palette.files', slot: 'overlay', order: 20, requires: 'desktop', component: () => <FilePalette /> },
  { id: 'palette.workspaces', slot: 'overlay', order: 30, component: () => <WorkspacePalette /> },
  {
    id: 'palette.pull-files', slot: 'overlay', order: 40,
    component: (props) => <Shortcuts onOpenShortcuts={() => props.context.openSettings('shortcuts')} />,
  },
]
