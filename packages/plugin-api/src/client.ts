// The client half of the plugin API. See docs/plugins/plugin-api.md § The plugin API for the entrypoint
// table, the tier boundary, and the entry criterion, and for what a `// prune candidate:` comment
// marks below.

// ── The plugin contract itself ────────────────────────────────────────────────────────────────
export type { ClientPlugin } from '@acorn/client-core/host/registries/extensionPoints'

// ── Data toolkit: transport, queries, events ──────────────────────────────────────────────────
export { postJson, readBytes, readJson, sendForm, writeJson } from '@acorn/client-core/infra/node'
export { queryOwner } from '@acorn/client-core/infra/node'
// `modelBackendsOptions` is everything a Generate control can spend, keys and installed agent CLIs
// alike. On this barrel because the first-run wizard draws the list on its own step, and the node
// probes PATH per read, so no plugin can assemble it from the integrations query.
// `workspaceExternalProjectsOptions` is the workspace's whole external-project map, every provider's
// rows in one read. A plugin needs it to answer "which of my connections serves this repo", which is
// the question a task link has to settle before it can name one.
// `deletedTasksOptions` is every deleted task's id, so a reference to one reads "Deleted task".
export {
  deletedTasksOptions,
  integrationsOptions,
  modelBackendsOptions,
  prefsOptions,
  projectsKey,
  projectsOptions,
  tasksKey,
  tasksOptions,
  workspaceExternalProjectsKey,
  workspaceExternalProjectsOptions,
  workspacesKey,
  workspacesOptions,
} from '@acorn/client-core/infra/queries.ts'
export type { Task } from '@acorn/client-core/infra/queries.ts'
export {
  clientEvents,
  consumePaneIntent,
  consumeTerminalFocusIntent,
  openPane,
  requestTerminalFocusIntent,
} from '@acorn/client-core/host/registries/commands'
export { openTarget } from '@acorn/client-core/features/notifications'
export type { PaneIntent } from '@acorn/client-core/host/registries/commands'
// prune candidate: the raw socket. Plugins should be reaching for registerWsChannel (below) or a
// ctx-provided subscription rather than attaching to the shared client themselves.
export {
  registerWsBinaryHandler,
  wsConnect,
  wsOnNotice,
  wsOnNodeEvent,
  wsOnPluginsChanged,
  wsOnReconnect,
  wsOnWorkflowStepChanged,
  wsOnWorkflowStepEvent,
  wsSend,
  wsSendToNode,
} from '@acorn/client-core/infra/node/wsClient.ts'
export type { NoticeFrame } from '@acorn/protocol/notices.ts'
export { registerWsChannel } from '@acorn/client-core/infra/node'
// A compiled plugin hearing the same `plugin:<id>:<verb>` broadcasts its loaded frames can declare.
// The subscriber returns its disposal because a model root, rather than the plugin host's registration
// pass, owns this listener's lifetime.
export { onPluginFrame } from '@acorn/client-core/host/plugins'
// Another plugin's name as a person reads it, for a line that says where something came from.
export { pluginLabel } from '@acorn/client-core/host/plugins'

// ── Contribution types ────────────────────────────────────────────────────────────────────────
export { paneContribution } from '@acorn/client-core/host/registries/panes/panes.ts'
export type {
  PaneContribution,
  PaneLayoutContribution,
  PaneModelContext,
} from '@acorn/client-core/host/registries/panes/panes.ts'
// The host's per-(pane, task) reactive root. A pane that declares `model` on a layout contribution
// gets this for free; a pane drawing itself with one `component` reaches for it directly, which is
// what the editor does to keep its per-file document pool across its own mounts
// (docs/panes/models.md § Pane models).
export { paneModel } from '@acorn/client-core/host/registries/panes'
export type { SourceContribution, SourceRouteContribution } from '@acorn/client-core/host/registries/sources'
// The context-menu registry (docs/plugins/menus-and-markers.md § Context menus). Both halves are here: a plugin
// registers rows for a location, and a plugin that DRAWS a list asks the registry what to put in its
// row menu, so github's pull-request list and core's rail list offer the same things. No component
// crosses — the `<For>` over these rows is eight lines with each host's own `Menu.Item`.
export {
  contextMenuItems,
  contextMenuRegistry,
  documentSelection,
  fileMenuTarget,
  registerContextMenuItems,
  runContextMenuItem,
} from '@acorn/client-core/host/registries/panes'
// Hover and diagnostics providers for a language on a Node, and the checks every owner applies to
// what they answer (docs/editor/document-surface.md § Language smarts).
export {
  LANGUAGE_REQUEST_TOO_LARGE,
  languageRequestTooLarge,
  positionAt,
  requestDiagnostics,
  resolveDocumentServices,
} from '@acorn/client-core/host/registries/panes'
export type { CheckedDiagnostic, DocumentServiceRoute } from '@acorn/client-core/host/registries/panes'
export type {
  ItemRowTarget,
  FileMenuTarget,
  AgentMessageTarget,
  AgentTurnTarget,
  ContentSelectionTarget,
} from '@acorn/client-core/host/registries/panes'
// Brand-mark registration. See docs/ui-design/icons.md § Icons for the two feeders and the `brand:<id>`
// glyph name they share.
export { brandMarkRegistry } from '@acorn/client-core/kit/tokens'
// Core's own URL for a project. A plugin building its own routes on top of `/p/:projectId` needs a
// way back to the bare project path, deselecting an item, a breadcrumb, without hardcoding a shape
// core owns.
export { projectPath } from '@acorn/client-core/host/registries/commands'
// One slot registry, two component shapes: the slot id picks which (docs/frontend/registries.md § Registries and
// plugins). `UiSlotContribution` is the union both arms satisfy.
export type {
  TaskSlotContribution,
  UiSlotContribution,
} from '@acorn/client-core/host/registries/extensionPoints/slots.ts'
// Rail status markers (docs/plugins/menus-and-markers.md § Rail markers). A plugin publishes marker data next to the
// state that owns it and the host draws the pixels: it picks the corner, the colour, the spin, and
// the tooltip legend. The registry itself stays off this surface; register through
// `ctx.railMarkers`, which binds the contribution to the plugin's own name.
export type { RailMarkerContribution } from '@acorn/client-core/host/registries/rail'
export type { RailMarker, RailMarkerDot } from '@acorn/client-core/features/tabs'
export type { ClientScheduleContribution } from '@acorn/client-core/host/registries/shell'
// Rows for the attention inbox (docs/notifications/rows-and-targets.md § What a row points at). The registry stays off
// this surface; a plugin registers through `ctx.attentionSources`, which binds the source to its own
// name. The types are here so a source that lives in its own file can say what it returns.
export type { AttentionItem, AttentionSourceContribution } from '@acorn/client-core/host/registries/rail'
// See docs/panes.md § Not a pane: the reference panel for what `openRefPanel` does.
export { openRefPanel } from '@acorn/client-core/host/registries/panes'
// The props a first-party reference panel receives. The registry value itself stays off this
// surface; a plugin registers through `ctx.refPanels`, which binds the provider to the plugin's own
// name.
export type { RefPanelProps } from '@acorn/client-core/host/registries/panes'
// A project-scoped surface: the plugin's own page at `/p/:projectId/x/<plugin>/…`, drawn beside its
// rail list. The registry itself, because there is no named member on the context for it and
// docs/contribution-kinds.md already names `ctx.contribute(projectSurfaceRegistry)` as the compiled
// way in.
export { projectSurfaceRegistry } from '@acorn/client-core/host/registries/panes'
export type { ProjectSurfaceContribution } from '@acorn/client-core/host/registries/panes'
// The registry value, not just the props type: first-run onboarding hosts whichever importers are
// registered rather than importing another plugin's component.
export { projectImporterRegistry } from '@acorn/client-core/host/registries/sources'
export type { ProjectImporterProps } from '@acorn/client-core/host/registries/sources'
export type { IntegrationFlowContribution } from '@acorn/client-core/host/registries/sources'
export { COMMAND_CLOSED, registerCommands } from '@acorn/client-core/host/registries/commands'
export { registerKeybindings } from '@acorn/client-core/host/registries/commands'
// `InputCommand` and `SearchCommand` are the interactive members a plugin builds in a function rather
// than inline. The other members add nothing over `ContributedCommand` and stay off this surface.
export type {
  CommandContribution,
  CommandExecutionContext,
  CommandOutcome,
  ContributedCommand,
  InputCommand,
  SearchCommand,
} from '@acorn/client-core/host/registries/commands'
// The load-once search adapter (docs/command-palette-and-shortcuts/palette-data.md § Palette data). A plugin whose
// rows are already on this machine — run targets, notes, docker resources — spreads this into a
// `search` command and gets no debounce, no minimum query, one fetch when the frame opens and local
// fuzzy filtering after that. A plugin querying a node instead writes its own `query`.
export { localSearch } from '@acorn/client-core/host/registries/commands'
// See docs/dashboards/panels.md § Provenance, and what a row may not claim for what `openInAppUrl`
// answers and how a URL's destination gets resolved.
export {
  contentLinkRegistry,
  handlePluginContentLinkClick,
  learnRefPrefixes,
  openInAppUrl,
  parseInAppTarget,
  scanContentRefs,
  splitRefTokens,
} from '@acorn/client-core/host/registries/panes'
export type { ContentLinkContribution, InAppTarget } from '@acorn/client-core/host/registries/panes'
// The project list from module-level code, for a content-link `path` resolver: the one caller with
// no component scope that still has to ask which repos acorn tracks. Reader only.
// `setProjectsLookup` belongs to the composition root and stays off this surface.
export { allProjects } from '@acorn/client-core/features/projects/projectLookup.ts'
// See docs/plugins/client-half.md § Loaded plugins: the client half for what a `refResolvers` entry answers.
// The query options only: a plugin consumes resolutions here but contributes a resolver from a
// manifest row, never from client code.
export { refResolutionsOptions } from '@acorn/client-core/host/registries/panes'
// Put a named collection's item in view, for a pane answering "show me this one" from somewhere else.
// The host owns scroll, the same way it owns selection, so a pane never selects a row out of the DOM.
export { revealCollectionItem } from '@acorn/client-core/kit/keys'
export { agentContextContributions } from '@acorn/client-core/host/registries/sources'
// Lets module-level plugin state drop its entries when a task is archived, a workspace is removed, or
// the active node changes.
export { onScopeEvicted } from '@acorn/client-core/host/registries/shell'

// ── Tasks, sessions, layout ───────────────────────────────────────────────────────────────────
export { activateTaskSignals, pathForTask } from '@acorn/client-core/features/tasks/activate.ts'
export {
  activeTaskId,
  dispatchLayout,
  focusedPane,
  isTerminalMax,
  setSelectedSource,
  setTerminalOpen,
} from '@acorn/client-core/features/tasks/tasks.ts'
export { isPaneId } from '@acorn/client-core/features/tasks'
export type { TaskLayout } from '@acorn/client-core/features/tasks'
export { createTask } from '@acorn/client-core/features/tasks'
export { requestTaskLaunch } from '@acorn/client-core/features/tabs/taskLaunch.ts'
export { openActionPicker } from '@acorn/client-core/host/registries/commands'
export { isArchiving } from '@acorn/client-core/features/tasks'
export { agentSessionsFor, refreshSessionSources, sendToSession } from '@acorn/client-core/features/tasks'
export type { SessionSummary } from '@acorn/client-core/features/tasks'
export { runApi } from '@acorn/client-core/features/tasks'
export { cachedTaskScripts } from '@acorn/client-core/features/tasks'
export { taskStatus, taskStatusRevision } from '@acorn/client-core/features/tasks'
// One task by id from module-level code, such as a rail marker that is handed only the id. Not reactive.
export { taskById } from '@acorn/client-core/features/tasks'

// ── Workspaces and projects ───────────────────────────────────────────────────────────────────
export { workspaceForProject } from '@acorn/client-core/features/workspaces'
// The workspace open now, for a gate that isn't a component and so can't read the route.
export { currentWorkspaceId } from '@acorn/client-core/features/workspaces'
export { createWorkspaceWords } from '@acorn/client-core/features/workspaces'

export { canAddProjectFromFolder, pickNodeFolder } from '@acorn/client-core/features/workspaces'
export { ownOnboardingVisibility } from '@acorn/client-core/features/workspaces'
export { createProject, createWorkspace, patchProject } from '@acorn/client-core/features/workspaces'
export type { Project } from '@acorn/protocol/api.ts'
export { WORKSPACES_PREF_KEY } from '@acorn/protocol/workspacesMode.ts'
export type { WorkspacesMode } from '@acorn/protocol/workspacesMode.ts'

// ── The fleet: which node a request goes to ───────────────────────────────────────────────────
export { activeNodeId, nodeReady, setActiveNode } from '@acorn/client-core/infra/node/activeNode.ts'
export { createFleetQuery } from '@acorn/client-core/infra/node'
export { nodes, nodeState } from '@acorn/client-core/infra/node/fleet.ts'
export { previewUrlForClient, remotePreviewBlocked } from '@acorn/client-core/infra/node'

// ── Agent context and references ──────────────────────────────────────────────────────────────
export { contextSnapshot } from '@acorn/client-core/features/agent'
export { composeForAgent, formatFileReference, sendReferenceToAgent } from '@acorn/client-core/features/agent'
export type { ReferenceTargetContribution } from '@acorn/client-core/features/agent'

// ── The platform seam ─────────────────────────────────────────────────────────────────────────
// What the host provides, as opposed to what the node provides. A plugin gets the groups it has a
// legitimate use for: the native folder dialog, the file dialogs, the host-owned preview view, and
// the loopback listener a sign-in returns to. The folder dialog comes only as `pickNodeFolder`,
// because every plugin folder so far is a Node's. Transport, fleet and plugin custody stay core's
// business.
export { canPickFolder, oauthCallback, pickFiles, previewViews, saveFile } from '@acorn/client-core/infra/platform'
// Native child webviews do not inherit DOM overflow clipping. Compiled surfaces that position one
// use the host's shared visible box rather than duplicating the clipping walk.
export { elementRectKey, visibleElementRect, observeNativePage } from '@acorn/client-core/infra/platform'

// ── Capabilities, prefs, persisted state ──────────────────────────────────────────────────────
// The host-side gate: is a desktop shell hosting this renderer, and does the node run a given plugin.
// `requires` on a contribution is the declarative form and is what almost everything should use; this
// is for a component that has to branch mid-render.
export { hasHostCapability } from '@acorn/client-core/infra/node'
// The other capability: a typed function another plugin published. Register through
// `ctx.capabilities`; these two are for reading one from a component, which has no ctx in hand.
export { clientCapability, clientCapabilityId } from '@acorn/client-core/infra/node'
export { parseJson } from '@acorn/client-core/infra/persistence'
export type { PersistedStateSlice } from '@acorn/client-core/infra/persistence'
export { PersistedSliceKeys, PrefKeys, storageKeyFor } from '@acorn/client-core/infra/persistence'
export { saveJsonPref, savePref } from '@acorn/client-core/features/settings/savePref.ts'
// The one shared "Generate with" default. Here rather than on ./ui because none of it is a component:
// a plugin's Generate dialog reads the pick, resolves it against the backends it was given, and writes
// the reader's next choice back for every other dialog to open on.
export {
  effectiveModelPick,
  modelPickLabel,
  readGeneratePick,
  saveGeneratePick,
} from '@acorn/client-core/features/settings'
export type { ModelPick } from '@acorn/client-core/features/settings'
export { openRepoConfigTrust } from '@acorn/client-core/features/settings'
// The settings save model, for a page drawn with `SettingRow` (docs/frontend/settings.md § Settings): the
// Saved signal and the error for a switch or select, a text field that keeps what was typed when its
// write fails, the question a Save-and-Cancel form asks before settings drops its changes, and the
// header's name and back link for one item a list page has open.
export {
  createSettingSave,
  createTextSetting,
  useSettingsDetail,
  useUnsavedChanges,
} from '@acorn/client-core/features/settings'
export type { SettingSave } from '@acorn/client-core/features/settings'

// ── Integrations, notifications, palette ──────────────────────────────────────────────────────
export { createDeviceFlow } from '@acorn/client-core/features/integrations'
// The other half of connecting a provider: the declared fields, what is required, and the write. A
// controller rather than a component for the reason the device flow is one — the wizard draws its own
// kit nodes, and it draws them on a host that has no DOM.
export { createCredentialForm } from '@acorn/client-core/features/integrations'

export type { BindingCandidate, BindingOrigin } from '@acorn/client-core/features/dataSources/fieldPickerModel.ts'
export { registerNoticeTargetHandler } from '@acorn/client-core/features/notifications'
// The attention model: an adapter turns a session row into a state, and the gate decides whether
// that state changing is news (docs/notifications.md).
export {
  defaultDeliveryContext,
  forgetAttentionSource,
  observeAttention,
  replaceAttentionSource,
} from '@acorn/client-core/features/notifications/deliver.ts'
export { markAttentionSeen, markTargetsRead } from '@acorn/client-core/features/notifications'
// Transient feedback. Notices persist in the bell, and a toast says "that worked" then gets out of
// the way.
export { toast } from '@acorn/client-core/features/notifications'
export { fuzzyScore } from '@acorn/client-core/kit/lib'

// ── Design-system helpers ─────────────────────────────────────────────────────────────────────
// Plain functions, no component in sight, which is why they sit here rather than on ./ui. Tokens,
// metrics, and the status/display vocabulary the shell renders by.
export { isAppDark, token, watchAppearance } from '@acorn/client-core/kit/tokens'
export { termFontSize } from '@acorn/client-core/kit/lib'
// `railDotProps` is the one translation from the rail's dot vocabulary to the kit's status dot.
export { fileStatusMeta, railDotProps, summarizeFileStats } from '@acorn/client-core/kit/lib'

// ── Telemetry and logging ─────────────────────────────────────────────────────────────────────
// The client half of what `ctx.telemetry` and `ctx.log` are on the node. The id is an argument because
// a compiled client plugin's context is contribution points and nothing else: `init` is the one place
// its own id is in hand (docs/plugin-authoring/telemetry.md § Telemetry and logging). A sandboxed frame
// gets neither; it posts a `telemetry` message over the bridge instead.
export { telemetryFor } from '@acorn/client-core/infra/telemetry/emitter.ts'
export { createLogger, describeError } from '@acorn/client-core/infra/telemetry'
// A pane that sets `reportsUsable` calls this once its content can be used
// (docs/plugin-authoring/telemetry.md § Reporting a usable pane).
export { featureUsable } from '@acorn/client-core/infra/telemetry'

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────
export { getHighlighter } from '@acorn/client-core/infra/highlight'
export { debounce } from '@acorn/client-core/kit/lib'
export { persistDraft } from '@acorn/client-core/kit/lib'
export { formatRelativeTime } from '@acorn/client-core/kit/lib'
// A shortcut as the app writes it everywhere: `meta+shift+n` reads ⇧⌘N.
export { formatChord } from '@acorn/client-core/kit/lib'
export { bytesOf, formatBytes, formatSize } from '@acorn/client-core/kit/lib'
// The staleness guard for a flow with several awaits.
export { latestSignal } from '@acorn/client-core/kit/lib'
export type { LatestSignal } from '@acorn/client-core/kit/lib'
export { onClosePaneWhen, onClosePaneWithin } from '@acorn/client-core/host/keys'

// "Is anyone offering to fill this slot?", for an owner's model that decides whether to draw the box.
// From the rule's own module, so a plugin model asking it doesn't load the tree host on ./ui/host.
export { slotFills } from '@acorn/client-core/host/tree/arbitration.ts'

// Per-device scraps — an unsent draft, a closed fold — through one guarded accessor. On this barrel
// rather than on ./ui because a plugin's own model is a `.ts` file with a node-environment test, and
// ./ui carries Solid components: one of those makes the whole entrypoint unloadable there
// (docs/plugin-authoring/testing.md § Testing).
export { clearLocal, deviceStorage, readLocal, writeLocal } from '@acorn/client-core/kit/lib'
