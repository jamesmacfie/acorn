// The client half of the plugin API. See docs/plugins.md § The plugin API for the entrypoint
// table, the tier boundary, and the entry criterion, and for what a `// prune candidate:` comment
// marks below.

// ── The plugin contract itself ────────────────────────────────────────────────────────────────
export type { ClientPlugin } from '@acorn/client-core/host/registries/extensionPoints/plugin.ts'

// ── Data toolkit: transport, queries, events ──────────────────────────────────────────────────
export { postJson, readBytes, readJson, sendForm, writeJson } from '@acorn/client-core/infra/node/apiClient.ts'
export {
  integrationsOptions,
  prefsOptions,
  projectsKey,
  projectsOptions,
  tasksKey,
  tasksOptions,
  workspacesKey,
  workspacesOptions,
} from '@acorn/client-core/infra/queries.ts'
export type { Task, Workspace } from '@acorn/client-core/infra/queries.ts'
export {
  clientEvents,
  consumePaneIntent,
  consumeTerminalFocusIntent,
  openPane,
  requestTerminalFocusIntent,
} from '@acorn/client-core/host/registries/commands/clientEvents.ts'
export { openTarget } from '@acorn/client-core/features/notifications/notifications.ts'
export type { PaneIntent } from '@acorn/client-core/host/registries/commands/clientEvents.ts'
// prune candidate: the raw socket. Plugins should be reaching for registerWsChannel (below) or a
// ctx-provided subscription rather than attaching to the shared client themselves.
export { wsAttach, wsConnect, wsOnNotice, wsOnStatus, wsOnWorkflowStepEvent, wsSend, wsWrite } from '@acorn/client-core/infra/node/wsClient.ts'
export type { WorkflowNotice } from '@acorn/client-core/infra/node/wsClient.ts'
export { registerWsChannel } from '@acorn/client-core/infra/node/wsChannels.ts'

// ── Contribution types ────────────────────────────────────────────────────────────────────────
export { paneContribution } from '@acorn/client-core/host/registries/panes/panes.ts'
export type { PaneContribution, PaneLayoutContribution, PaneRegistration } from '@acorn/client-core/host/registries/panes/panes.ts'
// The host's per-(pane, task) reactive root. A pane that declares `model` on a layout contribution
// gets this for free; a pane drawing itself with one `component` reaches for it directly, which is
// what the editor does to keep its per-file document pool across its own mounts
// (docs/panes.md § Layout model).
export { paneModel } from '@acorn/client-core/host/registries/panes/paneModels.ts'
export { sourceRegistry } from '@acorn/client-core/host/registries/sources/sources.ts'
export type { SourceContribution, SourceRouteContribution } from '@acorn/client-core/host/registries/sources/sources.ts'
// Brand-mark registration. See docs/ui-design.md § Icons for the two feeders and the `brand:<id>`
// glyph name they share.
export { brandMarkRegistry, brandStyle } from '@acorn/client-core/kit/tokens/brandMarks.ts'
// Core's own URL for a project. A plugin building its own routes on top of `/p/:projectId` needs a
// way back to the bare project path, deselecting an item, a breadcrumb, without hardcoding a shape
// core owns.
export { projectPath } from '@acorn/client-core/host/registries/commands/corePaths.ts'
// One slot registry, two component shapes: the slot id picks which (docs/frontend.md § Registries and
// plugins). `UiSlotContribution` is the union both arms satisfy.
export type { ShellSlotContribution, TaskSlotContribution, UiSlotContribution } from '@acorn/client-core/host/registries/extensionPoints/slots.ts'
// Rail status markers (docs/plugins.md § Rail markers). A plugin publishes marker data next to the
// state that owns it and the host draws the pixels: it picks the corner, the colour, the spin, and
// the tooltip legend. The registry itself stays off this surface; register through
// `ctx.railMarkers`, which binds the contribution to the plugin's own name.
export type { RailMarkerContribution, RailMarkerTarget } from '@acorn/client-core/host/registries/rail/railMarkerFeed.ts'
export type { RailMarker, RailMarkerDot, RailMarkerPosition, RailTone } from '@acorn/client-core/features/tabs/railMarkers.ts'
export type { PaletteRowSource } from '@acorn/client-core/host/registries/palette/paletteRows.ts'
export type { ClientScheduleContribution } from '@acorn/client-core/host/registries/shell/schedules.ts'
// See docs/panes.md § Not a pane: the reference panel for what `openRefPanel` does.
export { closeRefPanel, openRefPanel } from '@acorn/client-core/host/registries/panes/refPanels.ts'
// The props a first-party reference panel receives. The registry value itself stays off this
// surface; a plugin registers through `ctx.refPanels`, which binds the provider to the plugin's own
// name.
export type { RefPanelProps, RefPanelTarget } from '@acorn/client-core/host/registries/panes/refPanels.ts'
// The registry value, not just the props type: first-run onboarding hosts whichever importers are
// registered rather than importing another plugin's component.
export { projectImporterRegistry } from '@acorn/client-core/host/registries/sources/projectImporters.ts'
export type { ProjectImporterProps } from '@acorn/client-core/host/registries/sources/projectImporters.ts'
export type { IntegrationFlowContribution } from '@acorn/client-core/host/registries/sources/integrationFlows.ts'
export { COMMAND_CLOSED, registerCommands } from '@acorn/client-core/host/registries/commands/commands.ts'
// `InputCommand`, `SearchCommand` and `SettingCommand` are the three interactive members, for a plugin
// that builds one in a function rather than inline. The action and group members add nothing over
// `ContributedCommand` and stay off this surface.
export type {
  CommandContribution,
  CommandExecutionContext,
  CommandOutcome,
  ContributedCommand,
  InputCommand,
  SearchCommand,
  SettingCommand,
} from '@acorn/client-core/host/registries/commands/commands.ts'
// The load-once search adapter (docs/command-palette-and-shortcuts.md § Palette data). A plugin whose
// rows are already on this machine — run targets, notes, docker resources — spreads this into a
// `search` command and gets no debounce, no minimum query, one fetch when the frame opens and local
// fuzzy filtering after that. A plugin querying a node instead writes its own `query`.
export { localSearch } from '@acorn/client-core/host/registries/commands/localSearch.ts'
// See docs/dashboards.md § Provenance, and what a row may not claim for what `openInAppUrl`
// answers and how a URL's destination gets resolved.
export {
  contentLinkRegistry,
  handlePluginContentLinkClick,
  learnRefPrefixes,
  linkifyRefs,
  openInAppUrl,
  parseInAppTarget,
  REF_LINK_CLASS,
  scanContentRefs,
  splitRefTokens,
} from '@acorn/client-core/host/registries/panes/contentLinks.ts'
export type { ContentLinkContribution, InAppTarget } from '@acorn/client-core/host/registries/panes/contentLinks.ts'
// The project list from module-level code, for a content-link `path` resolver: the one caller with
// no component scope that still has to ask which repos acorn tracks. Reader only.
// `setProjectsLookup` belongs to the composition root and stays off this surface.
export { allProjects } from '@acorn/client-core/features/projects/projectLookup.ts'
// See docs/plugins.md § Loaded plugins: the client half for what a `refResolvers` entry answers.
// The query options only: a plugin consumes resolutions here but contributes a resolver from a
// manifest row, never from client code.
export { refResolutionsOptions } from '@acorn/client-core/host/registries/panes/refResolvers.ts'
export type { PluginRefResolution } from '@acorn/protocol/refResolvers.ts'
// Put a named collection's item in view, for a pane answering "show me this one" from somewhere else.
// The host owns scroll, the same way it owns selection, so a pane never selects a row out of the DOM.
export { revealCollectionItem } from '@acorn/client-core/kit/keys/collection.ts'
export { agentContextContributions } from '@acorn/client-core/host/registries/sources/agentContexts.ts'
// The tone of a tool call's status dot. Shared because two plugins draw that dot: agents owns the
// `agents:tool-card` point and changes fills it.
export { agentToolTone } from '@acorn/client-core/host/registries/shell/agentToolTone.ts'
export { onScopeEvicted } from '@acorn/client-core/host/registries/shell/scopeEviction.ts'

// ── Tasks, sessions, layout ───────────────────────────────────────────────────────────────────
export { activateTaskSignals, pathForTask } from '@acorn/client-core/features/tasks/activate.ts'
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
} from '@acorn/client-core/features/tasks/tasks.ts'
export { isPaneId } from '@acorn/client-core/features/tasks/taskLayout.ts'
export type { TaskLayout } from '@acorn/client-core/features/tasks/taskLayout.ts'
export { createTask } from '@acorn/client-core/features/tasks/taskMutations.ts'
export {
  activeTerminal,
  addSession,
  agentSessionsFor,
  refreshSessions,
  rememberActiveTerminal,
  requestTerminalFocus,
  sessions,
} from '@acorn/client-core/features/tasks/agentSessions.ts'
export { runApi } from '@acorn/client-core/features/tasks/runClient.ts'
export { taskBridge } from '@acorn/client-core/features/tasks/taskBridge.ts'
export { taskStatus } from '@acorn/client-core/features/tasks/taskStatus.ts'

// ── Workspaces and projects ───────────────────────────────────────────────────────────────────
export { workspaceForProject } from '@acorn/client-core/features/workspaces/activeWorkspace.ts'
export { createProject, createWorkspace, patchProject } from '@acorn/client-core/features/workspaces/workspaceMutations.ts'
export type { Project, ProjectPatch, ProjectSeed } from '@acorn/protocol/api.ts'

// ── The fleet: which node a request goes to ───────────────────────────────────────────────────
export { activeNodeId, nodeReady, setActiveNode } from '@acorn/client-core/infra/node/activeNode.ts'
export { createFleetQuery } from '@acorn/client-core/infra/node/fanout.ts'
export { nodes } from '@acorn/client-core/infra/node/fleet.ts'
export { closeTunnelsForTask, tunnelUrl } from '@acorn/client-core/infra/node/tunnelUrl.ts'

// ── Agent context and references ──────────────────────────────────────────────────────────────
export { contextSnapshot } from '@acorn/client-core/features/agent/contextSnapshot.ts'
export { formatFileReference, sendReferenceToAgent, setManagedAgentReferenceHandler } from '@acorn/client-core/features/agent/reference.ts'

// ── The platform seam ─────────────────────────────────────────────────────────────────────────
// What the host provides, as opposed to what the node provides. A plugin gets the groups it has a
// legitimate use for: the native folder dialog, the file dialogs, and the host-owned preview view.
// Transport, fleet and plugin custody stay core's business.
export { canPickFolder, pickFiles, pickFolder, previewViews, saveFile } from '@acorn/client-core/infra/platform/index.ts'
export type { PickedFile, PreviewState, PreviewViews, SaveRequest } from '@acorn/client-core/infra/platform/index.ts'

// ── Capabilities, prefs, persisted state ──────────────────────────────────────────────────────
// The host-side gate: is a desktop shell hosting this renderer, and does the node run a given plugin.
// `requires` on a contribution is the declarative form and is what almost everything should use; this
// is for a component that has to branch mid-render.
export { hasHostCapability } from '@acorn/client-core/infra/node/hostCapabilities.ts'
export type { HostCapabilityRequirement, HostRequirement } from '@acorn/client-core/infra/node/hostCapabilities.ts'
// The other capability: a typed function another plugin published. Register through
// `ctx.capabilities`; these two are for reading one from a component, which has no ctx in hand.
export { clientCapability, clientCapabilityId, requireClientCapability } from '@acorn/client-core/infra/node/clientCapabilities.ts'
export { parseJson } from '@acorn/client-core/infra/persistence/persistedState.ts'
export type { PersistedStateSlice } from '@acorn/client-core/infra/persistence/persistedState.ts'
export { PersistedSliceKeys, PrefKeys } from '@acorn/client-core/infra/persistence/prefKeys.ts'
export { saveJsonPref, savePref } from '@acorn/client-core/features/settings/savePref.ts'
export { openRepoConfigTrust } from '@acorn/client-core/features/settings/trust/configTrust.ts'

// ── Integrations, notifications, palette ──────────────────────────────────────────────────────
export { createDeviceFlow } from '@acorn/client-core/features/integrations/deviceFlow.ts'
export { renderMarkdown } from '@acorn/client-core/kit/lib/markdown.ts'
export { registerNoticeTargetHandler } from '@acorn/client-core/features/notifications/notifications.ts'
// The attention model: an adapter turns a session row into a state, and the gate decides whether
// that state changing is news (docs/notifications.md).
export { fromManagedSession, fromTerminalSession } from '@acorn/client-core/features/notifications/attention.ts'
export { defaultDeliveryContext, observeAttention, pushManagedAgentNotice } from '@acorn/client-core/features/notifications/deliver.ts'
export { markAttentionSeen } from '@acorn/client-core/features/notifications/attentionInbox.ts'
// Transient feedback. Notices persist in the bell, and a toast says "that worked" then gets out of
// the way.
export { toast } from '@acorn/client-core/features/notifications/toast.ts'
export { fuzzyScore } from '@acorn/client-core/kit/lib/paletteModel.ts'
export type { PaletteItem } from '@acorn/client-core/kit/lib/paletteModel.ts'
export { createOverlayPalette } from '@acorn/client-core/host/palette/overlay.ts'

// ── Design-system helpers ─────────────────────────────────────────────────────────────────────
// Plain functions, no component in sight, which is why they sit here rather than on ./ui. Tokens,
// metrics, and the status/display vocabulary the shell renders by.
export { isAppDark, isDarkColor, token, watchAppearance } from '@acorn/client-core/kit/tokens/appearance.ts'
// `rowHeightSm` is on ./ui instead: the one thing that needs a density number is a frame's
// virtualized grid.
export { rowHeight, termFontSize } from '@acorn/client-core/kit/lib/metrics.ts'
// `railDotProps` is here beside CHECK_TONE because that is what it is for: the rail's dot
// vocabulary is not the kit's, and this is the one translation between them.
export { CHECK_TONE, checkStatusTone, checksState, FAILED_STATUSES, fileStatusMeta, railDotProps, summarizeFileStats } from '@acorn/client-core/kit/lib/displayMeta.ts'

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────
export { getHighlighter, tokenizeAnsiLines } from '@acorn/client-core/infra/highlight/shiki.ts'
export { debounce } from '@acorn/client-core/kit/lib/debounce.ts'
export { persistDraft, readDraft, writeDraft } from '@acorn/client-core/kit/lib/draftState.ts'
export { formatRelativeTime } from '@acorn/client-core/kit/lib/formatRelativeTime.ts'
export { bytesOf, formatSize } from '@acorn/client-core/kit/lib/formatSize.ts'
export { latestOnly } from '@acorn/client-core/kit/lib/latestOnly.ts'
export { onClosePaneWhen, onClosePaneWithin } from '@acorn/client-core/host/keys/onClosePaneWithin.ts'

// Which sandboxed plugin, if any, draws a given agent tool call. Data, not a component: the component
// that mounts it is `RemoteTree` on ./ui/host. See docs/plugins.md § The tree contract.
export type { RemoteContribution } from '@acorn/client-core/host/tree/treeRegistry.ts'

// Per-device scraps — an unsent draft, a closed fold — through one guarded accessor. On this barrel
// rather than on ./ui because a plugin's own model is a `.ts` file with a node-environment test, and
// ./ui carries Solid components: one of those makes the whole entrypoint unloadable there
// (docs/plugin-authoring.md § Testing). Nothing in the module below imports anything.
export { clearLocal, deviceStorage, readLocal, writeLocal } from '@acorn/client-core/kit/lib/deviceStorage.ts'
