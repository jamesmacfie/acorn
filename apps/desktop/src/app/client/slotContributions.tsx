import type { UiSlotContribution } from '../../core/client/registries/uiSlots'
import NotificationBell from '../../core/client/notifications/NotificationBell'
import CommandPalette from '../../core/client/palette/CommandPalette'
import FilePalette from '../../core/client/palette/FilePalette'
import WorkspacePalette from '../../core/client/palette/WorkspacePalette'
import Shortcuts from '../../core/client/Shortcuts'
import ConfigTrustDialog from '../../core/client/configTrust/ConfigTrustDialog'

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
