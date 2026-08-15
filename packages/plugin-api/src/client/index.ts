// The client half of the plugin API: everything a plugin's client/ code needs that is not a
// component. Components live on @acorn/plugin-api/ui, and the diff toolkit on
// @acorn/plugin-api/ui/diff.
//
// That split is load-bearing, not cosmetic. These entrypoints are barrels, so importing one helper
// evaluates every module on the surface — and Solid compiles a component to code that touches
// `window` at module scope. A plugin's node-environment test suite can import this file; it cannot
// import ./ui. So the rule is mechanical: nothing here comes from a .tsx module. Registration and
// connected .tsx surfaces live on ./ui/host; frame-safe presentation components live on ./ui; and
// the design system's plain functions — token, the metrics, the display vocabulary — stay here.
//
// Everything below is a RE-EXPORT of client-core. Contribution TYPES are here; the registration
// functions are not — a plugin registers through ctx, never by reaching into a registry. The
// handful of registry values that are exported (paneContribution, sourceRegistry, registerCommands)
// are read/lookup helpers or a registration seam with no ctx equivalent yet.
//
// Every name here has a consumer. Thirty-two did not and were deleted: the whole
// workspace-external-projects group, the ref-panel and ref-resolver contribution types, `cx`,
// `ApiError`, `ClientPluginContext`. A contract is a promise about what will not change, and a promise
// nobody asked for is one you can only break.
//
// `// prune candidate:` still marks three surfaces that a first-party plugin reaches for today and a
// third-party plugin should not have. They stayed because removing them needs a NEW ctx seam — a
// subscription, a capability read — and inventing one to retire three exports is a worse trade than
// saying plainly what they are. Each names either the seam that would replace it or why it is
// first-party forever.

// ── The plugin contract itself ────────────────────────────────────────────────────────────────
export type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'

// ── Data toolkit: transport, queries, events ──────────────────────────────────────────────────
export { postJson, readBytes, readJson, sendForm, writeJson } from '@acorn/client-core/apiClient.ts'
export {
  integrationsOptions,
  prefsOptions,
  projectsKey,
  projectsOptions,
  tasksKey,
  tasksOptions,
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
export type { WorkflowNotice } from '@acorn/client-core/wsClient.ts'
export { registerWsChannel } from '@acorn/client-core/wsChannels.ts'

// ── Contribution types ────────────────────────────────────────────────────────────────────────
export { paneContribution } from '@acorn/client-core/registries/panes.ts'
export type { PaneContribution } from '@acorn/client-core/registries/panes.ts'
export { sourceRegistry } from '@acorn/client-core/registries/sources.ts'
export type { SourceContribution, SourceRouteContribution } from '@acorn/client-core/registries/sources.ts'
// A brand logo, as one SVG path's `d`. Only a COMPILED-IN plugin registers here — a loaded plugin
// declares `icon`/`icons` in its manifest and the host registers on its behalf, which is why the
// same `brand:<id>` glyph string works either way. Plain data, not a component, so `/client` is the
// right entrypoint.
export { brandMarkRegistry } from '@acorn/client-core/ui/brandMarks.ts'
// Core's own URL for a project. A plugin building its own routes on top of `/p/:projectId` needs to be
// able to get back to the bare project path — deselecting an item, a breadcrumb — without hardcoding a
// shape core owns.
export { projectPath } from '@acorn/client-core/registries/corePaths.ts'
export type { TaskSlotContribution, UiSlotContribution } from '@acorn/client-core/registries/slots.ts'
export type { PaletteRowSource } from '@acorn/client-core/registries/paletteRows.ts'
export type { PollerContribution } from '@acorn/client-core/registries/pollers.ts'
// `openRefPanel` is how a plugin shows another provider's item without leaving the page. The shell owns the
// presentation (registries/refPanelHost.tsx); a caller only says which ref, and gets `false` when that
// provider has no panel installed here — which is why `refPanelFor` ("does a panel exist?") came off this
// surface: the answer already arrives with the attempt, and nothing was asking it in advance.
export { closeRefPanel, openRefPanel } from '@acorn/client-core/registries/refPanels.ts'
// The registry value, not just the props type: first-run onboarding hosts whichever importers are
// registered rather than importing another plugin's component.
export { projectImporterRegistry } from '@acorn/client-core/registries/projectImporters.ts'
export type { ProjectImporterProps } from '@acorn/client-core/registries/projectImporters.ts'
export type { IntegrationFlowContribution } from '@acorn/client-core/registries/integrationFlows.ts'
export { registerCommands } from '@acorn/client-core/registries/commands.ts'
export {
  contentLinkRegistry,
  handlePluginContentLinkClick,
  learnRefPrefixes,
  linkifyRefs,
  parseInAppTarget,
  REF_LINK_CLASS,
  scanContentRefs,
  splitRefTokens,
} from '@acorn/client-core/registries/contentLinks.ts'
export type { ContentLinkContribution } from '@acorn/client-core/registries/contentLinks.ts'
// Batch enrichment for another plugin's items, addressed by provider. The query options only: a plugin
// CONSUMES resolutions, it does not contribute a resolver from client code (that is a manifest row), so
// neither the registry lookup nor the contribution type belongs on this surface.
export { refResolutionsOptions } from '@acorn/client-core/registries/refResolvers.ts'
export type { PluginRefResolution } from '@acorn/protocol/refResolvers.ts'
export { contextSectionContributions } from '@acorn/client-core/registries/contextSections.ts'
export { agentContextContributions } from '@acorn/client-core/registries/agentContexts.ts'
// prune candidate: agent-tool renderers are in-realm components drawn inside the transcript list,
// so they cannot cross a sandbox boundary. First-party only, permanently (docs/third-party § Two tiers).
export { agentToolRendererRegistry } from '@acorn/client-core/registries/agentToolRenderers.ts'
export type { AgentToolRendererContribution, AgentToolRendererProps } from '@acorn/client-core/registries/agentToolRenderers.ts'
export { agentToolTone } from '@acorn/client-core/registries/agentToolRenderers.ts'
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
export { createTask } from '@acorn/client-core/tasks/mutations.ts'
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
export { createProject, createWorkspace, patchProject } from '@acorn/client-core/workspaces/mutations.ts'
export type { Project, ProjectPatch, ProjectSeed } from '@acorn/protocol/api.ts'

// ── The fleet: which node a request goes to ───────────────────────────────────────────────────
export { activeNodeId, nodeReady, setActiveNode } from '@acorn/client-core/node/activeNode.ts'
export { createFleetQuery } from '@acorn/client-core/node/fanout.ts'
export { nodes } from '@acorn/client-core/node/fleet.ts'
export { closeTunnelsForTask, tunnelUrl } from '@acorn/client-core/node/tunnelUrl.ts'

// ── Agent context and references ──────────────────────────────────────────────────────────────
export { contextSnapshot } from '@acorn/client-core/agent/contextSnapshot.ts'
export { formatFileReference, sendReferenceToAgent, setManagedAgentReferenceHandler } from '@acorn/client-core/agent/reference.ts'

// ── The platform seam ─────────────────────────────────────────────────────────────────────────
// What the HOST provides, as opposed to what the node provides (git history: docs/future/node-first/platform-seam.md).
// A plugin gets the two groups it has a legitimate use for — the native folder dialog and the host-owned
// preview view — and nothing else: transport, fleet and plugin custody are core's business.
export { canPickFolder, pickFolder, previewViews } from '@acorn/client-core/platform/index.ts'
export type { PreviewState, PreviewViews } from '@acorn/client-core/platform/index.ts'

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
export { renderMarkdown } from '@acorn/client-core/integrations/markdown.ts'
export { pushManagedAgentNotice, registerNoticeTargetHandler } from '@acorn/client-core/notifications/notifications.ts'
// Transient feedback. Notices persist in the bell; a toast says "that worked" and gets out of the way.
// Three plugins had invented text-channel toasts before this existed.
export { toast } from '@acorn/client-core/notifications/toast.ts'
export { fuzzyScore } from '@acorn/client-core/palette/model.ts'
export type { PaletteItem } from '@acorn/client-core/palette/model.ts'
export { createOverlayPalette } from '@acorn/client-core/palette/overlay.ts'

// ── Design-system helpers ─────────────────────────────────────────────────────────────────────
// Plain functions, no component in sight, which is why they are on this side rather than ./ui —
// see the note at the top. Tokens, metrics and the status/display vocabulary the shell renders by.
// `cx` was here too and no plugin ever called it — seventeen of them write `class={...}` by hand.
export { isAppDark, isDarkColor, token, watchAppearance } from '@acorn/client-core/ui/appearance.ts'
// `rowHeightSm` is on ./ui instead: the one thing that needs a density number is a frame's virtualized grid.
export { rowHeight, termFontSize } from '@acorn/client-core/ui/metrics.ts'
export { CHECK_TONE, checkStatusTone, checksState, FAILED_STATUSES, fileStatusMeta, summarizeFileStats } from '@acorn/client-core/ui/displayMeta.ts'

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────
export { getHighlighter, tokenizeAnsiLines } from '@acorn/client-core/highlight/shiki.ts'
export { debounce } from '@acorn/client-core/lib/debounce.ts'
export { persistDraft, readDraft, writeDraft } from '@acorn/client-core/lib/draftState.ts'
export { formatRelativeTime } from '@acorn/client-core/lib/formatRelativeTime.ts'
export { bytesOf, formatSize } from '@acorn/client-core/lib/formatSize.ts'
export { latestOnly } from '@acorn/client-core/lib/latestOnly.ts'
export { onClosePaneWithin } from '@acorn/client-core/lib/onClosePaneWithin.ts'
