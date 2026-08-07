import { lazy } from 'solid-js'
import type { SettingsContribution } from '@acorn/client-core/registries/settings.ts'

// CORE's settings pages, and only core's. The five plugin-owned pages that used to sit in this list —
// agent-pricing (45), workflows (50), terminal (60), docker (65) and API requests (66) — are declared by
// the plugins that own them, in their client/index.ts. The order numbers are unchanged, and the registry
// sorts on them, so the visible page order is identical with the list split in two.
const WorkspaceRepoAssignments = lazy(() => import('@acorn/client-core/workspaces/WorkspaceRepoAssignments.tsx'))
const IntegrationsSettings = lazy(() => import('@acorn/client-core/settings/IntegrationsSettings.tsx'))
const WorkspaceSettings = lazy(() => import('@acorn/client-core/settings/WorkspaceSettings.tsx'))
const McpSettings = lazy(() => import('@acorn/client-core/settings/McpSettings.tsx'))
const AgentToolsSettings = lazy(() => import('@acorn/client-core/settings/AgentToolsSettings.tsx'))
const AppearanceSettings = lazy(() => import('@acorn/client-core/settings/AppearanceSettings.tsx'))
const ShortcutsSettings = lazy(() => import('@acorn/client-core/settings/ShortcutsSettings.tsx'))
const NodesSettings = lazy(() => import('@acorn/client-core/settings/NodesSettings.tsx'))
const PluginsSettings = lazy(() => import('@acorn/client-core/settings/PluginsSettings.tsx'))
const SecuritySettings = lazy(() => import('@acorn/client-core/settings/SecuritySettings.tsx'))
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
  // Core's, not agents': the tool registry it edits permissions for is projected from every plugin's
  // contributions, so no single plugin owns the page.
  { id: 'agent-tools', label: 'Agent tools', group: 'general', order: 40, component: () => <AgentToolsSettings /> },
  { id: 'shortcuts', label: 'Shortcuts', title: 'Keyboard shortcuts', group: 'general', order: 70, component: () => <ShortcutsSettings /> },
  // The slot the deleted Permissions page vacated (order 80). Not `requires: 'desktop'`: the page
  // renders its own explanation in a browser, where there is no broker and so no fleet.
  { id: 'nodes', label: 'Nodes', group: 'general', order: 80, component: () => <NodesSettings /> },
  // Beside Nodes, because both are node administration. Not `requires: 'desktop'`, for the same reason as
  // Nodes: the page explains itself in a browser, where there is no fleet to pick from.
  { id: 'plugins', label: 'Plugins', group: 'general', order: 85, component: () => <PluginsSettings /> },
  // Beside Nodes and Plugins, because all three are per-node administration and share the node picker.
  // security.md § Audit says the trail is "owner-readable in Settings"; this is that, plus the
  // disk-encryption posture § On-disk asks the app to surface.
  { id: 'security', label: 'Security', group: 'general', order: 90, component: () => <SecuritySettings /> },
  // Dev only: the style-pack authoring surface, not something a user needs.
  ...(import.meta.env.DEV
    ? [{ id: 'gallery', label: 'Style gallery', group: 'general' as const, order: 999, component: () => <StyleGallery /> }]
    : []),
]
