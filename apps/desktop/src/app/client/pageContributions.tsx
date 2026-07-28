import type { SettingsContribution } from '../../core/client/registries/settings'
import WorkspaceRepoAssignments from '../../core/client/workspaces/WorkspaceRepoAssignments'
import IntegrationsSettings from '../../core/client/settings/IntegrationsSettings'
import WorkspaceSettings from '../../core/client/settings/WorkspaceSettings'
import McpSettings from '../../core/client/settings/McpSettings'
import AgentToolsSettings from '../../core/client/settings/AgentToolsSettings'
import AgentPricingSettings from '../../plugins/agents/client/AgentPricingSettings'
import WorkflowsSettings from '../../plugins/workflows/client/WorkflowsSettings'
import AppearanceSettings from '../../core/client/settings/AppearanceSettings'
import TerminalSettings from '../../plugins/terminal/client/TerminalSettings'
import DockerSettings from '../../plugins/docker/client/DockerSettings'
import ShortcutsSettings from '../../core/client/settings/ShortcutsSettings'
import PermissionsSettings from '../../core/client/settings/PermissionsSettings'
import ApiSettings from '../../core/client/settings/ApiSettings'
import HttpVariablesSettings from '../../plugins/http/client/HttpVariablesSettings'
import StyleGallery from '../../core/client/settings/StyleGallery'

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
  { id: 'agent-pricing', label: 'Agent pricing', group: 'general', order: 45, requires: 'desktop', component: () => <AgentPricingSettings /> },
  { id: 'workflows', label: 'Workflows', group: 'general', order: 50, requires: 'desktop', component: () => <WorkflowsSettings /> },
  { id: 'terminal', label: 'Terminal', group: 'general', order: 60, requires: 'desktop', component: () => <TerminalSettings /> },
  { id: 'docker', label: 'Docker', group: 'general', order: 65, component: () => <DockerSettings /> },
  { id: 'shortcuts', label: 'Shortcuts', title: 'Keyboard shortcuts', group: 'general', order: 70, component: () => <ShortcutsSettings /> },
  {
    id: 'permissions', label: 'Permissions', group: 'general', order: 80,
    component: (props) => <PermissionsSettings onPermissions={props.context.onPermissions} />,
  },
  // 'api' is the public automation API's token page (docs/public-api.md); the API *panel*'s
  // variables are a different thing, hence the distinct id and label.
  { id: 'http', label: 'API requests', group: 'general', order: 66, component: () => <HttpVariablesSettings /> },
  { id: 'api', label: 'API', group: 'general', order: 90, requires: 'desktop', component: () => <ApiSettings /> },
  // Dev only: the style-pack authoring surface, not something a user needs.
  ...(import.meta.env.DEV
    ? [{ id: 'gallery', label: 'Style gallery', group: 'general' as const, order: 999, component: () => <StyleGallery /> }]
    : []),
]
