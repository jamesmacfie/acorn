import type { SettingsContribution } from '../../registries/settings'
import WorkspaceRepoAssignments from '../workspaces/WorkspaceRepoAssignments'
import IntegrationsSettings from '../integrations/IntegrationsSettings'
import WorkspaceSettings from './WorkspaceSettings'
import McpSettings from './McpSettings'
import AgentToolsSettings from './AgentToolsSettings'
import WorkflowsSettings from './WorkflowsSettings'
import AppearanceSettings from './AppearanceSettings'
import TerminalSettings from './TerminalSettings'
import ShortcutsSettings from './ShortcutsSettings'
import PermissionsSettings from './PermissionsSettings'

export const settingsPageContributions: SettingsContribution[] = [
  {
    id: 'workspaces', label: 'Workspaces', group: 'general', order: 0,
    component: () => <WorkspaceRepoAssignments />,
  },
  {
    id: 'workspace.detail', label: 'Workspace', group: 'workspace', order: 0,
    component: (props) => props.context.workspace
      ? <WorkspaceSettings workspace={props.context.workspace} onDeleted={props.context.onWorkspaceDeleted} />
      : null,
  },
  { id: 'appearance', label: 'Appearance', group: 'general', order: 10, component: () => <AppearanceSettings /> },
  { id: 'integrations', label: 'Integrations', group: 'general', order: 20, component: () => <IntegrationsSettings /> },
  { id: 'mcp', label: 'MCP', group: 'general', order: 30, component: () => <McpSettings /> },
  { id: 'agent-tools', label: 'Agent tools', group: 'general', order: 40, component: () => <AgentToolsSettings /> },
  { id: 'workflows', label: 'Workflows', group: 'general', order: 50, requires: 'desktop', component: () => <WorkflowsSettings /> },
  { id: 'terminal', label: 'Terminal', group: 'general', order: 60, requires: 'desktop', component: () => <TerminalSettings /> },
  { id: 'shortcuts', label: 'Shortcuts', title: 'Keyboard shortcuts', group: 'general', order: 70, component: () => <ShortcutsSettings /> },
  {
    id: 'permissions', label: 'Permissions', group: 'general', order: 80,
    component: (props) => <PermissionsSettings onPermissions={props.context.onPermissions} />,
  },
]
