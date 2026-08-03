import { lazy } from 'solid-js'
import type { SettingsContribution } from '@acorn/client-core/registries/settings.ts'

const WorkspaceRepoAssignments = lazy(() => import('@acorn/client-core/workspaces/WorkspaceRepoAssignments.tsx'))
const IntegrationsSettings = lazy(() => import('@acorn/client-core/settings/IntegrationsSettings.tsx'))
const WorkspaceSettings = lazy(() => import('@acorn/client-core/settings/WorkspaceSettings.tsx'))
const McpSettings = lazy(() => import('@acorn/client-core/settings/McpSettings.tsx'))
const AgentToolsSettings = lazy(() => import('@acorn/client-core/settings/AgentToolsSettings.tsx'))
const AgentPricingSettings = lazy(() => import('@acorn/plugin-agents/client/AgentPricingSettings.tsx'))
const WorkflowsSettings = lazy(() => import('@acorn/plugin-workflows/client/WorkflowsSettings.tsx'))
const AppearanceSettings = lazy(() => import('@acorn/client-core/settings/AppearanceSettings.tsx'))
const TerminalSettings = lazy(() => import('@acorn/plugin-terminal/client/TerminalSettings.tsx'))
const DockerSettings = lazy(() => import('@acorn/plugin-docker/client/DockerSettings.tsx'))
const ShortcutsSettings = lazy(() => import('@acorn/client-core/settings/ShortcutsSettings.tsx'))
const HttpVariablesSettings = lazy(() => import('@acorn/plugin-http/client/HttpVariablesSettings.tsx'))
const StyleGallery = lazy(() => import('@acorn/client-core/settings/StyleGallery.tsx'))

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
  // 'api' is the public automation API's token page (docs/public-api.md); the API *panel*'s
  // variables are a different thing, hence the distinct id and label.
  { id: 'http', label: 'API requests', group: 'general', order: 66, component: () => <HttpVariablesSettings /> },
  // Dev only: the style-pack authoring surface, not something a user needs.
  ...(import.meta.env.DEV
    ? [{ id: 'gallery', label: 'Style gallery', group: 'general' as const, order: 999, component: () => <StyleGallery /> }]
    : []),
]
