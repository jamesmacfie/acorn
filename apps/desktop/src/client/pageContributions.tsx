import { lazy } from 'solid-js'
import type { SettingsContribution } from '@acorn/client-core/host/registries/shell'
import { CORE_SETTINGS_PAGES, type CoreSettingsPageId } from '@acorn/client-core/features/settings'

const WorkspaceProjectAssignments = lazy(() => import('@acorn/client-core/features/workspaces/WorkspaceProjectAssignments.tsx'))
const ServicesSettings = lazy(() => import('@acorn/client-core/features/settings/connections/ServicesSettings.tsx'))
const AiModelsSettings = lazy(() => import('@acorn/client-core/features/settings/models/AiModelsSettings.tsx'))
const WorkspaceSettings = lazy(() => import('@acorn/client-core/features/settings/WorkspaceSettings.tsx'))
const ProjectSettings = lazy(() => import('@acorn/client-core/features/settings/ProjectSettings.tsx'))
const McpSettings = lazy(() => import('@acorn/client-core/features/settings/McpSettings.tsx'))
const AgentToolsSettings = lazy(() => import('@acorn/client-core/features/settings/AgentToolsSettings.tsx'))
const AppearanceSettings = lazy(() => import('@acorn/client-core/features/settings/AppearanceSettings.tsx'))
const NotificationSettings = lazy(() => import('@acorn/client-core/features/settings/NotificationSettings.tsx'))
const CliSettings = lazy(() => import('./CliSettings.tsx'))
const ShortcutsSettings = lazy(() => import('@acorn/client-core/features/settings/ShortcutsSettings.tsx'))
const NodesSettings = lazy(() => import('@acorn/client-core/features/settings/nodes/NodesSettings.tsx'))
const PluginsSettings = lazy(() => import('@acorn/client-core/features/settings/plugins/PluginsSettings.tsx'))
const RailSurfacesSettings = lazy(() => import('@acorn/client-core/features/settings/plugins/RailSurfacesSettings.tsx'))
const SecuritySettings = lazy(() => import('@acorn/client-core/features/settings/SecuritySettings.tsx'))
const AuditLogSettings = lazy(() => import('@acorn/client-core/features/settings/AuditLogSettings.tsx'))
const SchedulesSettings = lazy(() => import('@acorn/client-core/features/settings/SchedulesSettings.tsx'))
const RunsSettings = lazy(() => import('@acorn/client-core/features/settings/RunsSettings.tsx'))
const StorageSettings = lazy(() => import('@acorn/client-core/features/settings/StorageSettings.tsx'))
const StyleGallery = lazy(() => import('@acorn/client-core/features/settings/StyleGallery.tsx'))
const TelemetrySettings = lazy(() => import('@acorn/client-core/features/settings/TelemetrySettings.tsx'))
const DeviceConfigSettings = lazy(() => import('@acorn/client-core/features/settings/DeviceConfigSettings.tsx'))
const ExtensionPointsDev = lazy(() => import('@acorn/client-core/features/settings/ExtensionPointsDev.tsx'))
const ClearCacheSettings = lazy(() => import('./ClearCacheSettings.tsx'))

// How this app draws each of core's settings pages. Where a page sits, what it affects and what
// search finds on it are declared once in client-core, because the terminal client lists the same
// pages (client-core/features/settings/corePages.ts). A record over every id, so a page added there
// fails the build here until the desktop can draw it.
const components: Record<CoreSettingsPageId, SettingsContribution['component']> = {
  appearance: () => <AppearanceSettings />,
  notifications: () => <NotificationSettings />,
  shortcuts: () => <ShortcutsSettings />,
  cli: () => <CliSettings />,
  workspaces: (props) => <WorkspaceProjectAssignments navigate={props.context.navigate} />,
  'workspace.detail': (props) => props.context.scope.workspace
    ? <WorkspaceSettings workspace={props.context.scope.workspace} context={props.context} />
    : null,
  'project.detail': (props) => props.context.scope.project
    ? <ProjectSettings project={props.context.scope.project} context={props.context} />
    : null,
  'agent-tools': (props) => <AgentToolsSettings navigate={props.context.navigate} />,
  mcp: (props) => <McpSettings context={props.context} />,
  integrations: (props) => <ServicesSettings context={props.context} />,
  'ai-models': (props) => <AiModelsSettings context={props.context} />,
  schedules: (props) => <SchedulesSettings nodeId={props.context.scope.nodeId} />,
  runs: (props) => <RunsSettings nodeId={props.context.scope.nodeId} />,
  nodes: () => <NodesSettings />,
  security: (props) => <SecuritySettings nodeId={props.context.scope.nodeId} />,
  audit: (props) => <AuditLogSettings nodeId={props.context.scope.nodeId} />,
  telemetry: (props) => <TelemetrySettings nodeId={props.context.scope.nodeId} />,
  storage: (props) => <StorageSettings nodeId={props.context.scope.nodeId} />,
  plugins: (props) => <PluginsSettings context={props.context} />,
  'rail-surfaces': () => <RailSurfacesSettings />,
  'device-config': () => <DeviceConfigSettings />,
  'clear-cache': () => <ClearCacheSettings />,
  'extension-points': () => <ExtensionPointsDev />,
}

export const settingsPageContributions: SettingsContribution[] = [
  ...CORE_SETTINGS_PAGES.map((page) => ({ ...page, component: components[page.id] })),
  // Dev only: the style-pack authoring surface, not something a user needs.
  ...(import.meta.env.DEV
    ? [{
      id: 'gallery', label: 'Style gallery', category: 'advanced' as const, scope: 'device' as const, icon: 'swatch-book', order: 40,
      fullWidth: true, component: () => <StyleGallery />,
    }]
    : []),
]
