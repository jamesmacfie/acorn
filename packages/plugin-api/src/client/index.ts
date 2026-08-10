// The client half of the plugin API: everything a plugin's client/ code needs that is not a
// component. Components live on @acorn/plugin-api/ui, and the diff toolkit on
// @acorn/plugin-api/ui/diff.
//
// That split is load-bearing, not cosmetic. These entrypoints are barrels, so importing one helper
// evaluates every module on the surface — and Solid compiles a component to code that touches
// `window` at module scope. A plugin's node-environment test suite can import this file; it cannot
// import ./ui. So the rule is mechanical: nothing here comes from a .tsx module. Registration and
// connected .tsx surfaces live on ./ui/host; frame-safe presentation components live on ./ui; and
// the design system's plain functions — cx, token, the metrics — stay here.
//
// Everything below is a RE-EXPORT of client-core. Contribution TYPES are here; the registration
// functions are not — a plugin registers through ctx, never by reaching into a registry. The
// handful of registry values that are exported (paneContribution, sourceRegistry, refPanelFor,
// registerCommands) are read/lookup helpers or a registration seam with no ctx equivalent yet.
//
// `// prune candidate:` marks a surface that is on here because a first-party plugin reaches for
// it today, not because it belongs on a third-party contract. Each one is a small follow-up, not
// a reason to hold up the facade.

// ── The plugin contract itself ────────────────────────────────────────────────────────────────
export type { ClientPlugin, ClientPluginContext } from '@acorn/client-core/registries/plugin.ts'

// ── Data toolkit: transport, queries, events ──────────────────────────────────────────────────
export { ApiError, postJson, readBytes, readJson, sendForm, sendJson, writeJson } from '@acorn/client-core/apiClient.ts'
export type { WriteInit } from '@acorn/client-core/apiClient.ts'
export {
  integrationsOptions,
  prefsOptions,
  projectsKey,
  projectsOptions,
  tasksKey,
  tasksOptions,
  workspaceExternalProjectsKey,
  workspaceExternalProjectsOptions,
  workspacesKey,
  workspacesOptions,
} from '@acorn/client-core/queries.ts'
export type { Task, Workspace } from '@acorn/client-core/queries.ts'
export {
  clientEvents,
  consumePaneIntent,
  consumeTerminalFocusIntent,
  openPane,
  requestTerminalFocusIntent,
} from '@acorn/client-core/registries/clientEvents.ts'
export type { PaneIntent } from '@acorn/client-core/registries/clientEvents.ts'
// prune candidate: the raw socket. Plugins should be reaching for registerWsChannel (below) or a
// ctx-provided subscription rather than attaching to the shared client themselves.
export { wsAttach, wsConnect, wsOnNotice, wsOnStatus, wsOnWorkflowStepEvent, wsSend, wsWrite } from '@acorn/client-core/wsClient.ts'
export { registerWsChannel } from '@acorn/client-core/wsChannels.ts'

// ── Contribution types ────────────────────────────────────────────────────────────────────────
export { paneContribution } from '@acorn/client-core/registries/panes.ts'
export type { PaneContribution } from '@acorn/client-core/registries/panes.ts'
export { sourceRegistry } from '@acorn/client-core/registries/sources.ts'
export type { SourceContribution, SourcePromotionContext, SourceRouteContribution } from '@acorn/client-core/registries/sources.ts'
// Core's own URL for a project. A plugin building its own routes on top of `/p/:projectId` needs to be
// able to get back to the bare project path — deselecting an item, a breadcrumb — without hardcoding a
// shape core owns.
export { projectPath } from '@acorn/client-core/registries/corePaths.ts'
export type { TaskSlotContribution, UiSlotContribution } from '@acorn/client-core/registries/slots.ts'
export type { PaletteRowSource } from '@acorn/client-core/registries/paletteRows.ts'
export type { PollerContribution } from '@acorn/client-core/registries/pollers.ts'
export { refPanelFor } from '@acorn/client-core/registries/refPanels.ts'
export type { RefPanelContribution, RefPanelTarget } from '@acorn/client-core/registries/refPanels.ts'
// The registry value, not just the props type: first-run onboarding hosts whichever importers are
// registered rather than importing another plugin's component.
export { projectImporterRegistry } from '@acorn/client-core/registries/projectImporters.ts'
export type { ProjectImporterContribution, ProjectImporterProps } from '@acorn/client-core/registries/projectImporters.ts'
export type { IntegrationFlowContribution } from '@acorn/client-core/registries/integrationFlows.ts'
export { registerCommands } from '@acorn/client-core/registries/commands.ts'
export {
  contentLinkRegistry,
  handlePluginContentLinkClick,
  openPluginContentTarget,
  parseInAppTarget,
} from '@acorn/client-core/registries/contentLinks.ts'
export type { ContentLinkContribution } from '@acorn/client-core/registries/contentLinks.ts'
export { contextSectionContributions } from '@acorn/client-core/registries/contextSections.ts'
export { agentContextContributions } from '@acorn/client-core/registries/agentContexts.ts'
// prune candidate: agent-tool renderers are in-realm components drawn inside the transcript list,
// so they cannot cross a sandbox boundary. First-party only, permanently (docs/third-party § Two tiers).
export { agentToolRendererRegistry } from '@acorn/client-core/registries/agentToolRenderers.ts'
export type { AgentToolRendererContribution, AgentToolRendererProps } from '@acorn/client-core/registries/agentToolRenderers.ts'
export { onScopeEvicted } from '@acorn/client-core/registries/scopeEviction.ts'

// ── Tasks, sessions, layout ───────────────────────────────────────────────────────────────────
export { activateTaskSignals, pathForTask } from '@acorn/client-core/tasks/activate.ts'
export {
  activeTaskId,
  dispatchActiveLayout,
  dispatchLayout,
  focusedPane,
  isTerminalMax,
  recipeBrowserUrl,
  setRecipeBrowserUrl,
  setSelectedSource,
  setTerminalOpen,
} from '@acorn/client-core/tasks/tasks.ts'
export { isPaneId } from '@acorn/client-core/tasks/layout.ts'
export type { TaskLayout } from '@acorn/client-core/tasks/layout.ts'
export { addTaskLink, createTask } from '@acorn/client-core/tasks/mutations.ts'
export {
  activeTerminal,
  addSession,
  agentSessionsFor,
  refreshSessions,
  rememberActiveTerminal,
  requestTerminalFocus,
  sessions,
} from '@acorn/client-core/tasks/agentSessions.ts'
export { runApi } from '@acorn/client-core/tasks/runClient.ts'
export { taskBridge } from '@acorn/client-core/tasks/taskBridge.ts'
export { taskStatus } from '@acorn/client-core/tasks/taskStatus.ts'

// ── Workspaces and projects ───────────────────────────────────────────────────────────────────
export { workspaceForProject } from '@acorn/client-core/workspaces/activeWorkspace.ts'
export { createProject, createWorkspace, patchProject, renameWorkspace, setWorkspaceExternalProjects } from '@acorn/client-core/workspaces/mutations.ts'
export type { Project, ProjectPatch, ProjectSeed } from '@acorn/protocol/api.ts'

// ── The fleet: which node a request goes to ───────────────────────────────────────────────────
export { activeNodeId, nodeReady, setActiveNode } from '@acorn/client-core/node/activeNode.ts'
export { createFleetQuery } from '@acorn/client-core/node/fanout.ts'
export { nodes } from '@acorn/client-core/node/fleet.ts'
export { closeTunnelsForTask, tunnelUrl } from '@acorn/client-core/node/tunnelUrl.ts'

// ── Agent context and references ──────────────────────────────────────────────────────────────
export { contextSnapshot } from '@acorn/client-core/agent/contextSnapshot.ts'
export { formatFileReference, sendReferenceToAgent, setManagedAgentReferenceHandler } from '@acorn/client-core/agent/reference.ts'

// ── Capabilities, prefs, persisted state ──────────────────────────────────────────────────────
// prune candidate: `capabilities` is the node's capability read model. A plugin should be asking
// ctx what it may do rather than reading the shared signal.
export { capabilities } from '@acorn/client-core/capabilities.ts'
export { clientCapability, clientCapabilityId } from '@acorn/client-core/clientCapabilities.ts'
export { parseJson } from '@acorn/client-core/persistence/persistedState.ts'
export type { PersistedStateSlice } from '@acorn/client-core/persistence/persistedState.ts'
export { PersistedSliceKeys, PrefKeys } from '@acorn/client-core/persistence/prefKeys.ts'
export { saveJsonPref, savePref } from '@acorn/client-core/settings/savePref.ts'
export { openRepoConfigTrust } from '@acorn/client-core/configTrust/configTrust.ts'

// ── Integrations, notifications, palette ──────────────────────────────────────────────────────
export { createDeviceFlow } from '@acorn/client-core/integrations/deviceFlow.ts'
export type { DeviceFlowController } from '@acorn/client-core/integrations/deviceFlow.ts'
export { renderMarkdown } from '@acorn/client-core/integrations/markdown.ts'
export {
  replaceWorkspaceExternalProjectsForProvider,
  workspaceExternalProjectsForProvider,
} from '@acorn/client-core/integrations/workspaceProjects.ts'
export { pushManagedAgentNotice, registerNoticeTargetHandler } from '@acorn/client-core/notifications/notifications.ts'
export { fuzzyScore } from '@acorn/client-core/palette/model.ts'
export type { PaletteItem } from '@acorn/client-core/palette/model.ts'
export { createOverlayPalette } from '@acorn/client-core/palette/overlay.ts'

// ── Design-system helpers ─────────────────────────────────────────────────────────────────────
// Plain functions, no component in sight, which is why they are on this side rather than ./ui —
// see the note at the top. Tokens, metrics and the status/display vocabulary the shell renders by.
export { isAppDark, isDarkColor, token, watchAppearance } from '@acorn/client-core/ui/appearance.ts'
export { rowHeight, rowHeightSm, termFontSize } from '@acorn/client-core/ui/metrics.ts'
export { checksState, FAILED_STATUSES, fileStatusMeta, summarizeFileStats } from '@acorn/client-core/ui/displayMeta.ts'
export { createDismissable } from '@acorn/client-core/ui/dismissable.ts'
export { cx } from '@acorn/client-core/ui/cx.ts'

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────
export { getHighlighter, tokenizeAnsiLines } from '@acorn/client-core/highlight/shiki.ts'
export { debounce } from '@acorn/client-core/lib/debounce.ts'
export { persistDraft, readDraft, writeDraft } from '@acorn/client-core/lib/draftState.ts'
export { formatRelativeTime } from '@acorn/client-core/lib/formatRelativeTime.ts'
export { bytesOf, formatSize } from '@acorn/client-core/lib/formatSize.ts'
export { latestOnly } from '@acorn/client-core/lib/latestOnly.ts'
export { onClosePaneWithin } from '@acorn/client-core/lib/onClosePaneWithin.ts'
