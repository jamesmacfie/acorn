import { lazy } from 'solid-js'
import type { SettingsContribution } from '../../core/client/registries/settings'

const WorkspaceRepoAssignments = lazy(() => import('../../core/client/workspaces/WorkspaceRepoAssignments'))
const IntegrationsSettings = lazy(() => import('../../core/client/settings/IntegrationsSettings'))
const WorkspaceSettings = lazy(() => import('../../core/client/settings/WorkspaceSettings'))
const McpSettings = lazy(() => import('../../core/client/settings/McpSettings'))
const AgentToolsSettings = lazy(() => import('../../core/client/settings/AgentToolsSettings'))
const AgentPricingSettings = lazy(() => import('../../plugins/agents/client/AgentPricingSettings'))
const WorkflowsSettings = lazy(() => import('../../plugins/workflows/client/WorkflowsSettings'))
const AppearanceSettings = lazy(() => import('../../core/client/settings/AppearanceSettings'))
const TerminalSettings = lazy(() => import('../../plugins/terminal/client/TerminalSettings'))
const DockerSettings = lazy(() => import('../../plugins/docker/client/DockerSettings'))
const ShortcutsSettings = lazy(() => import('../../core/client/settings/ShortcutsSettings'))
const PermissionsSettings = lazy(() => import('../../core/client/settings/PermissionsSettings'))
const HttpVariablesSettings = lazy(() => import('../../plugins/http/client/HttpVariablesSettings'))
const StyleGallery = lazy(() => import('../../core/client/settings/StyleGallery'))

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
  // Dev only: the style-pack authoring surface, not something a user needs.
  ...(import.meta.env.DEV
    ? [{ id: 'gallery', label: 'Style gallery', group: 'general' as const, order: 999, component: () => <StyleGallery /> }]
    : []),
]
