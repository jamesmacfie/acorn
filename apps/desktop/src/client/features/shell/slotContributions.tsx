import type { UiSlotContribution } from '../../registries/uiSlots'
import NotificationBell from '../notifications/NotificationBell'
import CommandPalette from '../palette/CommandPalette'
import FilePalette from '../palette/FilePalette'
import WorkspacePalette from '../palette/WorkspacePalette'
import Shortcuts from '../../Shortcuts'

export const shellSlotContributions: UiSlotContribution[] = [
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
