import { lazy } from 'solid-js'
import type { SettingsContribution } from '@acorn/client-core/host/registries/shell/settings.ts'

const WorkspaceProjectAssignments = lazy(() => import('@acorn/client-core/features/workspaces/WorkspaceProjectAssignments.tsx'))
const IntegrationsSettings = lazy(() => import('@acorn/client-core/features/settings/IntegrationsSettings.tsx'))
const WorkspaceSettings = lazy(() => import('@acorn/client-core/features/settings/WorkspaceSettings.tsx'))
const McpSettings = lazy(() => import('@acorn/client-core/features/settings/McpSettings.tsx'))
const AgentToolsSettings = lazy(() => import('@acorn/client-core/features/settings/AgentToolsSettings.tsx'))
const AppearanceSettings = lazy(() => import('@acorn/client-core/features/settings/AppearanceSettings.tsx'))
const NotificationSettings = lazy(() => import('@acorn/client-core/features/settings/NotificationSettings.tsx'))
const ShortcutsSettings = lazy(() => import('@acorn/client-core/features/settings/ShortcutsSettings.tsx'))
const NodesSettings = lazy(() => import('@acorn/client-core/features/settings/nodes/NodesSettings.tsx'))
const PluginsSettings = lazy(() => import('@acorn/client-core/features/settings/PluginsSettings.tsx'))
const SecuritySettings = lazy(() => import('@acorn/client-core/features/settings/SecuritySettings.tsx'))
const SchedulesSettings = lazy(() => import('@acorn/client-core/features/settings/SchedulesSettings.tsx'))
const RunsSettings = lazy(() => import('@acorn/client-core/features/settings/RunsSettings.tsx'))
const StyleGallery = lazy(() => import('@acorn/client-core/features/settings/StyleGallery.tsx'))
const TelemetrySettings = lazy(() => import('@acorn/client-core/features/settings/TelemetrySettings.tsx'))

export const settingsPageContributions: SettingsContribution[] = [
  {
    id: 'workspaces', label: 'Projects', group: 'general', order: 0,
    component: () => <WorkspaceProjectAssignments />,
  },
  {
    id: 'workspace.detail', label: 'Workspace', group: 'workspace', order: 0,
    component: (props) => props.context.workspace
      ? <WorkspaceSettings workspace={props.context.workspace} onDeleted={props.context.onWorkspaceDeleted} />
      : null,
  },
  { id: 'appearance', label: 'Appearance', group: 'general', order: 10, component: () => <AppearanceSettings /> },
  // Beside Appearance, because both describe this screen rather than the node: which notifications
  // this machine makes is a device preference, like the theme.
  { id: 'notifications', label: 'Notifications', group: 'general', order: 15, component: () => <NotificationSettings /> },
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
  // With the other three per-node administration pages, and sharing their node picker: a schedule is a
  // promise one machine makes (docs/schedules.md).
  { id: 'schedules', label: 'Schedules', group: 'general', order: 95, component: () => <SchedulesSettings /> },
  // Beside Schedules, and the same argument: a run happens on one machine. Core's rather than any
  // plugin's, because the list is merged from every plugin that declared a run source and no one of
  // them owns it (@acorn/protocol/runs.ts).
  { id: 'runs', label: 'Runs', group: 'general', order: 96, component: () => <RunsSettings /> },
  // Beside Security, and the same argument: both answer "what does this machine disclose", and
  // `telemetry.enabled` is a preference on the node rather than on this screen (docs/telemetry.md).
  { id: 'telemetry', label: 'Telemetry', group: 'general', order: 92, component: () => <TelemetrySettings /> },
  // Dev only: the style-pack authoring surface, not something a user needs.
  ...(import.meta.env.DEV
    ? [{ id: 'gallery', label: 'Style gallery', group: 'general' as const, order: 999, component: () => <StyleGallery /> }]
    : []),
]
