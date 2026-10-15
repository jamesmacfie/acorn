# Phase 7 audit: every facade export with one importer or none

This table goes with the [plugin API audit](./07-plugin-api-audit.md). It lists every export of
`@acorn/plugin-api` that had one importer, or none, when the phase started on October 15, 2026.

## How it was counted

`node tools/arch/facadeConsumers.ts` prints the counts and every export's importers. It reads the
names from `packages/plugin-api/src/surface.snapshot.txt` and the imports from every TypeScript and
JavaScript file outside the facade, tests included. It counts named imports, re-exports, `import *`
with the members used, and destructured dynamic imports. An importer is a workspace folder, such as
`plugins/agents` or `apps/tui`.

| Consumers | Exports before | Exports after |
| --- | --- | --- |
| None | 11 | 10 |
| One | 398 | 385 |
| Two | 122 | 123 |
| Three or more | 241 | 241 |

The October 14 count in the phase doc found 664 names and 278 with one consumer. It counted only
production code in `plugins/` and `apps/`. This count adds tests, `packages/` and `tools/`, and the
testkit and UI entrypoints, which is why it finds 772 names.

The 10 left with no importer are closed-kit nodes. `facadeConsumers.test.ts` exempts them, because
the kit offers every node to every plugin and the support matrix test holds that list.

## The groups

- **Keep**: a seam core offers plugins in general, or a registry with one contributor so far. Core
  uses most of these itself.
- **Moved**: a plugin's internals. They now live in that plugin.
- **Made general**: a seam shaped for one plugin, now one any plugin can use.
- **Deleted**: nothing imported it.

The 66 rows with `packages/plugin-sdk` as the consumer are names the published `acorn-plugin-sdk` re-exports.
Outside plugins call them, and the published packages are out of scope for this phase.

## The table

| Export | Consumer | Group | Reason |
| --- | --- | --- | --- |
| `node: codexJsonAdapter` | agents | Moved | Codex's stdout shape. Now `plugins/agents/src/server/profiles/codexStream.ts`, beside the codex profile |
| `client: setManagedAgentReferenceHandler` | agents | Made general | A single slot where the last caller won. Replaced by `ctx.referenceTargets`, a registry any plugin contributes to by priority; core's session fallback is one entry |
| `client: AgentMessageTarget` | agents | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: AgentTurnTarget` | agents | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: CommandContribution` | agents | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: ModelPick` | agents | Keep | Core feature a plugin reads; core uses it too |
| `client: SettingSave` | agents | Keep | Core feature a plugin reads; core uses it too |
| `client: agentContextContributions` | agents | Keep | Reads the agent-context registry every plugin contributes to |
| `client: brandMarkRegistry` | agents | Keep | Kit helper or design token; core renders with it too |
| `client: createFleetQuery` | agents | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `client: createTextSetting` | agents | Keep | Core feature a plugin reads; core uses it too |
| `client: defaultDeliveryContext` | agents | Keep | Core's notification and attention ring; any plugin with notices uses it |
| `client: describeError` | agents | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `client: formatBytes` | agents | Keep | Kit helper or design token; core renders with it too |
| `client: markAttentionSeen` | agents | Keep | Core's notification and attention ring; any plugin with notices uses it |
| `client: markTargetsRead` | agents | Keep | Core's notification and attention ring; any plugin with notices uses it |
| `client: modelPickLabel` | agents | Keep | Core feature a plugin reads; core uses it too |
| `client: observeAttention` | agents | Keep | Core's notification and attention ring; any plugin with notices uses it |
| `client: pickFiles` | agents | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `client: saveFile` | agents | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `client: sendForm` | agents | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `client: useSettingsDetail` | agents | Keep | Core feature a plugin reads; core uses it too |
| `node: AGENTS_CUSTOM_AGENT_REGISTRY` | agents | Keep | Core replays manifest harnesses and custom agents into these, so their ids and shapes live where core can name them |
| `node: AGENTS_HARNESS_REGISTRY` | agents | Keep | Core replays manifest harnesses and custom agents into these, so their ids and shapes live where core can name them |
| `node: AGENT_TOOL_PASSTHROUGH` | agents | Keep | Core server seam; core uses it too |
| `node: AgentProfileContribution` | agents | Keep | Core server seam; core uses it too |
| `node: Argv` | agents | Keep | Registers core's acorn MCP server into an agent CLI. Core boot and headless runs use it, and any plugin's profile calls it |
| `node: CoreProcService` | agents | Keep | Type of a core service on `ctx.core` |
| `node: DeliverableSkill` | agents | Keep | Core's skill registry. Any plugin contributes skills; agents delivers them |
| `node: FILE_GUARD_MATCHER` | agents | Keep | The policy core's MCP server enforces. Agents writes it, core reads it |
| `node: FileGuardPolicy` | agents | Keep | The policy core's MCP server enforces. Agents writes it, core reads it |
| `node: HEADLESS_TIMEOUT_MS` | agents | Keep | Core's one-shot headless runner |
| `node: HarnessRegistry` | agents | Keep | Core replays manifest harnesses and custom agents into these, so their ids and shapes live where core can name them |
| `node: Launcher` | agents | Keep | Registers core's acorn MCP server into an agent CLI. Core boot and headless runs use it, and any plugin's profile calls it |
| `node: ManifestCustomAgent` | agents | Keep | Core replays manifest harnesses and custom agents into these, so their ids and shapes live where core can name them |
| `node: ManifestHarness` | agents | Keep | Core replays manifest harnesses and custom agents into these, so their ids and shapes live where core can name them |
| `node: McpCommands` | agents | Keep | Registers core's acorn MCP server into an agent CLI. Core boot and headless runs use it, and any plugin's profile calls it |
| `node: PrefService` | agents | Keep | Core service or its type |
| `node: SearchHit` | agents | Keep | Wire type core owns |
| `node: acornFileGuard` | agents | Keep | Registers core's acorn MCP server into an agent CLI. Core boot and headless runs use it, and any plugin's profile calls it |
| `node: acornLoopHook` | agents | Keep | Registers core's acorn MCP server into an agent CLI. Core boot and headless runs use it, and any plugin's profile calls it |
| `node: configureAcornMcp` | agents | Keep | Registers core's acorn MCP server into an agent CLI. Core boot and headless runs use it, and any plugin's profile calls it |
| `node: confineExistingFile` | agents | Keep | Core service or its type |
| `node: decodeSecretInput` | agents | Keep | Core's secret detector |
| `node: deliverableSkills` | agents | Keep | Core's skill registry. Any plugin contributes skills; agents delivers them |
| `node: encodeFileGuardPolicy` | agents | Keep | The policy core's MCP server enforces. Agents writes it, core reads it |
| `node: envFlags` | agents | Keep | Registers core's acorn MCP server into an agent CLI. Core boot and headless runs use it, and any plugin's profile calls it |
| `node: lineDelimitedJsonAdapter` | agents | Keep | Core's stdout readings. Core's headless run uses one, and a manifest harness picks either |
| `node: recordSkillDelivery` | agents | Keep | Core's skill registry. Any plugin contributes skills; agents delivers them |
| `node: redactSecretText` | agents | Keep | Core's secret detector |
| `node: registerAcornMcp` | agents | Keep | Registers core's acorn MCP server into an agent CLI. Core boot and headless runs use it, and any plugin's profile calls it |
| `node: textAdapter` | agents | Keep | Core's stdout readings. Core's headless run uses one, and a manifest harness picks either |
| `testkit: CoreServices` | agents | Keep | Test fixture over core state |
| `testkit: catalogueSkills` | agents | Keep | Core's skill registry. Any plugin contributes skills; agents delivers them |
| `testkit: fileToolRefusal` | agents | Keep | The policy core's MCP server enforces. Agents writes it, core reads it |
| `testkit: readPackageSkill` | agents | Keep | Core's skill registry. Any plugin contributes skills; agents delivers them |
| `testkit: registerSkill` | agents | Keep | Core's skill registry. Any plugin contributes skills; agents delivers them |
| `testkit: skillDeliveries` | agents | Keep | Core's skill registry. Any plugin contributes skills; agents delivers them |
| `testkit: skillStateStore` | agents | Keep | Core's skill registry. Any plugin contributes skills; agents delivers them |
| `ui/host: IconPicker` | agents | Keep | Closed-kit component or its type |
| `ui/host: McpConfigFiles` | agents | Keep | Core's MCP settings component, drawn by both hosts |
| `ui/host: SelectedContent` | agents | Keep | Contribution type of the selection-actions registry |
| `ui/host: confirmAction` | agents | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `ui/host: markdownFences` | agents | Keep | Host component or seam that both shells draw |
| `ui: MentionSegment` | agents | Keep | Closed-kit component or its type |
| `ui: MentionSource` | agents | Keep | Closed-kit component or its type |
| `ui: Popover` | agents | Keep | Closed-kit component or its type |
| `ui: ReadingPlace` | agents | Keep | Closed-kit component or its type |
| `ui: TimelineControls` | agents | Keep | Closed-kit component or its type |
| `ui: createTimelineWindow` | agents | Keep | Kit helper that windows a long timeline, offered beside the Timeline node |
| `client: SessionSummary` | context | Keep | Type of the session-sources registry |
| `client: bytesOf` | context | Keep | Kit helper or design token; core renders with it too |
| `client: formatSize` | context | Keep | Kit helper or design token; core renders with it too |
| `node: DataColumn` | database | Keep | Type of core's data service |
| `node: DataTable` | database | Keep | Core service or its type |
| `testkit: GenerateTextRequest` | database | Keep | Test fixture over core state |
| `testkit: ModelService` | database | Keep | Test fixture over core state |
| `testkit: ProviderOperationError` | database | Keep | Test fixture over core state |
| `testkit: createProjectService` | database | Keep | Test fixture over core state |
| `ui/tree: defaultModelIdFor` | database | Keep | Core feature a plugin reads; core uses it too |
| `ui/tree: formatChord` | database | Keep | Kit helper or design token; core renders with it too |
| `ui/tree: modelProviderFailure` | database | Keep | Kit helper or design token; core renders with it too |
| `client: TaskSlotContribution` | docker | Keep | Contribution type of the task slot registry |
| `testkit: BridgeError` | docker | Keep | Test fixture over core state |
| `ui/host: AnnotationMarks` | docker | Keep | Host component or seam that both shells draw |
| `ui: FindBar` | docker | Keep | Closed-kit component or its type |
| `client: CheckedDiagnostic` | editor | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: DocumentServiceRoute` | editor | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: FileMenuTarget` | editor | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: LANGUAGE_REQUEST_TOO_LARGE` | editor | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: LatestSignal` | editor | Keep | Kit helper or design token; core renders with it too |
| `client: PaneContribution` | editor | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: documentSelection` | editor | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: fileMenuTarget` | editor | Keep | Lookup on a host registry (menus, close keys, document services) |
| `client: languageRequestTooLarge` | editor | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: onClosePaneWhen` | editor | Keep | Lookup on a host registry (menus, close keys, document services) |
| `client: paneModel` | editor | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: positionAt` | editor | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: requestDiagnostics` | editor | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: resolveDocumentServices` | editor | Keep | Lookup on a host registry (menus, close keys, document services) |
| `client: storageKeyFor` | editor | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `testkit/client: commandRegistry` | editor | Keep | Test fixture over core state |
| `testkit/client: documentServiceRegistry` | editor | Keep | Test fixture over core state |
| `testkit/client: setActiveTaskId` | editor | Keep | Test fixture over core state |
| `testkit/client: setFocusedPane` | editor | Keep | Test fixture over core state |
| `testkit: confineExistingFile` | editor | Keep | Test fixture over core state |
| `testkit: isContainedPath` | editor | Keep | Test fixture over core state |
| `testkit: isValidRepoIdent` | editor | Keep | Test fixture over core state |
| `testkit: resolveInRoot` | editor | Keep | Test fixture over core state |
| `ui/editor: EditorViewState` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: RichTooltipContent` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: applyViewState` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: captureViewState` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: editorSearch` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: editorTheme` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: fileDocumentCustodies` | editor | Keep | Document custody is core's; the desktop and terminal hosts both import it |
| `ui/editor: languageForPath` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: languageServices` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: openReplacePanel` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: refreshEditorTheme` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: refreshLanguageServices` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: reserveDocumentDestinations` | editor | Keep | Document custody is core's; the desktop and terminal hosts both import it |
| `ui/editor: reserveFileSourceCustodies` | editor | Keep | Document custody is core's; the desktop and terminal hosts both import it |
| `ui/editor: richTooltipDom` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: richTooltipTheme` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: shouldHighlightDocument` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/editor: watchEditorTheme` | editor | Keep | Core feature a plugin reads; core uses it too |
| `ui/host: annotationsFor` | editor | Keep | Host component or seam that both shells draw |
| `ui/tokens: HOST` | editor | Keep | Kit helper or design token; core renders with it too |
| `ui: ToggleButton` | editor | Keep | Closed-kit component or its type |
| `ui: sidebarCollapse` | editor | Keep | Kit helper or design token; core renders with it too |
| `client: RailMarkerDot` | git | Keep | Core feature a plugin reads; core uses it too |
| `client: isArchiving` | git | Keep | Core feature a plugin reads; core uses it too |
| `client: openActionPicker` | git | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: requestTaskLaunch` | git | Keep | Core's task launch and status state |
| `client: taskStatus` | git | Keep | Core feature a plugin reads; core uses it too |
| `client: taskStatusRevision` | git | Keep | Core's task launch and status state |
| `node: GenerateTextRequest` | git | Keep | Core service or its type |
| `node: SECRET_DETECTOR_VERSION` | git | Keep | Core's secret detector |
| `node: gitText` | git | Keep | Core service or its type |
| `node: worktreeGitText` | git | Keep | Core's worktree service |
| `node: worktreeStatusText` | git | Keep | Core's worktree service |
| `testkit: beginTaskArchive` | git | Keep | Test fixture over core state |
| `testkit: finishTaskArchive` | git | Keep | Test fixture over core state |
| `testkit: onServerError` | git | Keep | Test fixture over core state |
| `ui/diff: diffScopeKey` | git | Keep | Core feature a plugin reads; core uses it too |
| `ui/diff: documentTopology` | git | Keep | Diff document model, shared by every diff view |
| `ui/diff: synth` | git | Keep | Diff document model, shared by every diff view |
| `ui: HistoryMark` | git | Keep | Closed-kit component or its type |
| `ui: historyLayout` | git | Keep | Closed-kit component or its type |
| `client: CHECK_TONE` | github | Moved | GitHub check-run vocabulary in the core kit. Now `plugins/github/src/client/checks/checkStatus.ts` |
| `client: FAILED_STATUSES` | github | Moved | GitHub check-run vocabulary in the core kit. Now `plugins/github/src/client/checks/checkStatus.ts` |
| `client: checkStatusTone` | github | Moved | GitHub check-run vocabulary in the core kit. Now `plugins/github/src/client/checks/checkStatus.ts` |
| `client: checkStatusWord` | github | Moved | GitHub check-run vocabulary in the core kit. Now `plugins/github/src/client/checks/checkStatus.ts` |
| `client: checksState` | github | Moved | GitHub check-run vocabulary in the core kit. Now `plugins/github/src/client/checks/checkStatus.ts` |
| `client: checksSummary` | github | Moved | GitHub check-run vocabulary in the core kit. Now `plugins/github/src/client/checks/checkStatus.ts` |
| `node: diffDocumentBlobKey` | github | Moved | Keys of GitHub's pull request blob cache. Now `plugins/github/src/server/blobKeys.ts` |
| `node: fileBodyBlobKey` | github | Moved | Keys of GitHub's pull request blob cache. Now `plugins/github/src/server/blobKeys.ts` |
| `node: patchBlobKey` | github | Moved | Keys of GitHub's pull request blob cache. Now `plugins/github/src/server/blobKeys.ts` |
| `testkit: patchBlobKey` | github | Moved | Keys of GitHub's pull request blob cache. Now `plugins/github/src/server/blobKeys.ts` |
| `client: ContentLinkContribution` | github | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: InAppTarget` | github | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: IntegrationFlowContribution` | github | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: ProjectImporterProps` | github | Keep | Contribution type of the project importer registry |
| `client: RefPanelProps` | github | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: canPickFolder` | github | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `client: contentLinkRegistry` | github | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: createTask` | github | Keep | Core feature a plugin reads; core uses it too |
| `client: handlePluginContentLinkClick` | github | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: learnRefPrefixes` | github | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: openRefPanel` | github | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: openTarget` | github | Keep | Core feature a plugin reads; core uses it too |
| `client: parseInAppTarget` | github | Keep | Content-link and ref-resolver registries. Any plugin that recognises links uses them |
| `client: projectsKey` | github | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `client: railDotProps` | github | Keep | Kit helper or design token; core renders with it too |
| `client: refResolutionsOptions` | github | Keep | Content-link and ref-resolver registries. Any plugin that recognises links uses them |
| `client: scanContentRefs` | github | Keep | Content-link and ref-resolver registries. Any plugin that recognises links uses them |
| `client: splitRefTokens` | github | Keep | Content-link and ref-resolver registries. Any plugin that recognises links uses them |
| `client: summarizeFileStats` | github | Keep | Totals over the kit's diff file type, for any change view |
| `client: taskById` | github | Keep | Core feature a plugin reads; core uses it too |
| `client: workspaceExternalProjectsKey` | github | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `client: workspaceExternalProjectsOptions` | github | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `node: Cached` | github | Keep | Core server seam; core uses it too |
| `node: PluginBroadcast` | github | Keep | Plugin host type |
| `node: RefreshResult` | github | Keep | Core server seam; core uses it too |
| `node: chunkRowsByColumnBudget` | github | Keep | Core's SQLite batching helper, for any plugin table |
| `node: connectProvider` | github | Keep | Integration provider contract |
| `node: lazyFetch` | github | Keep | Plugin host type or registry |
| `node: providerCredential` | github | Keep | Integration credential read, for any provider plugin |
| `node: providerError` | github | Keep | Integration provider contract |
| `node: serveThenRevalidate` | github | Keep | Core server seam; core uses it too |
| `testkit/client: Project` | github | Keep | Test fixture over core state |
| `testkit/client: activeRefPanel` | github | Keep | Test fixture over core state |
| `testkit/client: closeRefPanel` | github | Keep | Test fixture over core state |
| `testkit/client: contentLinkRegistry` | github | Keep | Test fixture over core state |
| `testkit/client: openInAppUrl` | github | Keep | Test fixture over core state |
| `testkit/client: parseInAppTarget` | github | Keep | Content-link and ref-resolver registries. Any plugin that recognises links uses them |
| `testkit/client: refPanelRegistry` | github | Keep | Test fixture over core state |
| `testkit: AppDatabase` | github | Keep | Test fixture over core state |
| `testkit: PluginDatabase` | github | Keep | Test fixture over core state |
| `testkit: ProjectRef` | github | Keep | Test fixture over core state |
| `testkit: decryptSecret` | github | Keep | Test fixture over core state |
| `testkit: settleBackground` | github | Keep | Test fixture over core state |
| `testkit: testGate` | github | Keep | Test fixture over core state |
| `testkit: testSecretEnv` | github | Keep | Test fixture over core state |
| `ui/diff: DiffDocumentTopology` | github | Keep | Diff document model, shared by every diff view |
| `ui/diff: DiffSnippetAnchor` | github | Keep | Diff excerpts around a line, for any review surface. A GitLab plugin would draw review threads the same way |
| `ui/diff: DiffSnippetLine` | github | Keep | Diff excerpts around a line, for any review surface. A GitLab plugin would draw review threads the same way |
| `ui/diff: DiffSnippets` | github | Keep | Diff excerpts around a line, for any review surface. A GitLab plugin would draw review threads the same way |
| `ui/diff: createDiffSnippets` | github | Keep | Diff excerpts around a line, for any review surface. A GitLab plugin would draw review threads the same way |
| `ui/host: ProviderHtml` | github | Keep | Host component or seam that both shells draw |
| `ui/host: RefPanelBox` | github | Keep | Host component or seam that both shells draw |
| `ui/host: RefPanelTaskLink` | github | Keep | Host component or seam that both shells draw |
| `ui: Composer` | github | Keep | Closed-kit component or its type |
| `ui: KitSection` | github | Keep | Closed-kit component or its type |
| `ui: Sections` | github | Keep | Closed-kit component or its type |
| `ui: UserAvatar` | github | Keep | Closed-kit component or its type |
| `node: SessionTaskInfo` | http | Keep | Type of core's task environment |
| `node: ProviderItemComment` | linear | Keep | Integration provider contract |
| `node: ProviderItemImage` | linear | Keep | Integration provider contract |
| `node: connectionHasCapability` | linear | Keep | Integration provider contract |
| `node: ModelProviderAdapter` | model-providers | Keep | Core server seam; core uses it too |
| `testkit: connectProvider` | model-providers | Keep | Test fixture over core state |
| `testkit: rotateConnection` | model-providers | Keep | Test fixture over core state |
| `testkit: testConnection` | model-providers | Keep | Test fixture over core state |
| `node: NodeProviderContribution` | nodes-file | Keep | Node provider registry contract |
| `node: NodeSpec` | nodes-file | Keep | Node provider registry contract |
| `node: ProvidedNodeRecord` | nodes-file | Keep | Node provider registry contract |
| `client: InputCommand` | notes | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `node: formatOmitted` | notes | Keep | Core's context-section helper, for any section |
| `testkit: setRouteTestCapability` | notes | Keep | Test fixture over core state |
| `client: WORKSPACES_PREF_KEY` | onboarding | Keep | Core preference, read by the shell |
| `client: WorkspacesMode` | onboarding | Keep | Core preference, read by the shell |
| `client: createCredentialForm` | onboarding | Keep | Core feature a plugin reads; core uses it too |
| `client: createDeviceFlow` | onboarding | Keep | Core feature a plugin reads; core uses it too |
| `client: createProject` | onboarding | Keep | Core feature a plugin reads; core uses it too |
| `client: createWorkspace` | onboarding | Keep | Core feature a plugin reads; core uses it too |
| `client: ownOnboardingVisibility` | onboarding | Keep | One-owner slot the shell reads. The onboarding plugin is its contributor so far |
| `client: patchProject` | onboarding | Keep | Core feature a plugin reads; core uses it too |
| `client: projectImporterRegistry` | onboarding | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `ui/host: Wizard` | onboarding | Keep | Host component or seam that both shells draw |
| `ui/sdk: PluginByteResponse` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: PluginFrameContext` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: PluginTelemetryAttrs` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: RemoteNode` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: RemoteRoot` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: TreeMount` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: TreeRender` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: connect` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: createNode` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: createText` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: firstChild` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: insertNode` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: isTextNode` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: mountFrame` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: nextSibling` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: openLinkOnClick` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: parentOf` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: removeNode` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: setProperty` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/sdk: setText` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: DescriptionList` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: DiffLine` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: DiffPane` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: DocumentTabs` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Fallback` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: FileHead` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: FindBar` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: KIT_NODE_COMPONENTS` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Kbd` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: KitNodeProps` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Link` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Log` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: MentionTextarea` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Menu` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: NonCodeRow` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Only` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Pane` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: PickerRow` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Popover` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: RowActions` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Rows` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Slot` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Spinner` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: SplitCell` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: SplitHandle` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: StackedDiff` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: StatusDot` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Table` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: TableCell` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: TableHead` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: TableRow` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: Timeline` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: ToggleButton` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: UserAvatar` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: createComponent` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: createElement` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: createTextNode` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: effect` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: insert` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: insertNode` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: memo` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: mergeProps` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: render` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: setProp` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: spread` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `ui/tree: use` | packages/plugin-sdk | Keep | Re-exported by the published SDK, whose callers are outside plugins |
| `client: elementRectKey` | preview | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `client: observeNativePage` | preview | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `client: previewUrlForClient` | preview | Keep | Core's rule on which Node's preview may load, read from fleet state the facade does not expose. Phase 9 decides its future |
| `client: previewViews` | preview | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `client: remotePreviewBlocked` | preview | Keep | Core's rule on which Node's preview may load, read from fleet state the facade does not expose. Phase 9 decides its future |
| `client: visibleElementRect` | preview | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `node: ProviderResourceContext` | rollbar | Keep | Integration provider contract |
| `node: ProviderResourceRefreshContext` | rollbar | Keep | Integration provider contract |
| `node: parseJson` | rollbar | Keep | Integration provider contract |
| `node: Logger` | sentry-telemetry | Keep | Core server seam; core uses it too |
| `node: TelemetryAttrs` | sentry-telemetry | Keep | Wire type core owns |
| `node: TelemetryBatch` | sentry-telemetry | Keep | Wire type core owns |
| `node: scrub` | sentry-telemetry | Keep | Core server seam; core uses it too |
| `client: WorkflowNotice` | terminal | Made general | The bell-row frame under a workflow name. The facade exports it as `NoticeFrame`, its protocol name |
| `client: TaskLayout` | terminal | Keep | Core's task layout |
| `client: cachedTaskScripts` | terminal | Keep | Core's task script cache |
| `client: consumeTerminalFocusIntent` | terminal | Keep | The task drawer is shell state that the desktop and terminal shells read. Phase 8 covers the shells' terminal wiring |
| `client: forgetAttentionSource` | terminal | Keep | Core's notification and attention ring; any plugin with notices uses it |
| `client: getHighlighter` | terminal | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `client: isAppDark` | terminal | Keep | Kit helper or design token; core renders with it too |
| `client: isPaneId` | terminal | Keep | Core's task layout |
| `client: isTerminalMax` | terminal | Keep | The task drawer is shell state that the desktop and terminal shells read. Phase 8 covers the shells' terminal wiring |
| `client: onClosePaneWithin` | terminal | Keep | Host key seam |
| `client: paneContribution` | terminal | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: registerWsBinaryHandler` | terminal | Keep | Core's socket seam for binary frames |
| `client: replaceAttentionSource` | terminal | Keep | Core's notification and attention ring; any plugin with notices uses it |
| `client: runApi` | terminal | Keep | Core feature a plugin reads; core uses it too |
| `client: termFontSize` | terminal | Keep | Reads the style pack's `--term-fs` token |
| `client: token` | terminal | Keep | Kit helper or design token; core renders with it too |
| `client: watchAppearance` | terminal | Keep | Kit helper or design token; core renders with it too |
| `client: wsOnNotice` | terminal | Keep | Core infrastructure: Node requests, platform, persistence, or socket |
| `node: LayoutRecipe` | terminal | Keep | Core server seam; core uses it too |
| `node: RUN_TARGETS` | terminal | Keep | Core's run-target route, bridged to whichever plugin runs targets |
| `node: RunTarget` | terminal | Keep | Core server seam; core uses it too |
| `node: TASK_CREATED` | terminal | Keep | Hooks on core's worktree routes, one contributor so far |
| `node: TASK_SESSIONS` | terminal | Keep | Hooks on core's worktree routes, one contributor so far |
| `node: TEARDOWN_TIMEOUT_MS` | terminal | Keep | Core server seam; core uses it too |
| `node: TaskCreatedHook` | terminal | Keep | Hooks on core's worktree routes, one contributor so far |
| `node: TaskSessionsBridge` | terminal | Keep | Hooks on core's worktree routes, one contributor so far |
| `node: childEnv` | terminal | Keep | Core server seam; core uses it too |
| `node: interactiveProfile` | terminal | Keep | Core's agent profile lookups |
| `node: listProfiles` | terminal | Keep | Core's agent profile lookups |
| `node: registerAcornMcpBeforeSpawn` | terminal | Keep | Registers core's acorn MCP server into an agent CLI. Core boot and headless runs use it, and any plugin's profile calls it |
| `node: rendererBaseCheckout` | terminal | Keep | Core's worktree service |
| `node: resolveMcpEntry` | terminal | Keep | Registers core's acorn MCP server into an agent CLI. Core boot and headless runs use it, and any plugin's profile calls it |
| `node: serverName` | terminal | Keep | Registers core's acorn MCP server into an agent CLI. Core boot and headless runs use it, and any plugin's profile calls it |
| `node: taskContext` | terminal | Keep | Core server seam; core uses it too |
| `node: tmuxAvailable` | terminal | Keep | Core's agent profile lookups |
| `testkit/client: isDarkColor` | terminal | Keep | Design token helper |
| `testkit/ws-client: _resetWsClient` | terminal | Keep | Test reset for core's socket client |
| `testkit: RunBridge` | terminal | Keep | Core's run-target route, bridged to whichever plugin runs targets |
| `testkit: RunTarget` | terminal | Keep | Test fixture over core state |
| `testkit: harness` | terminal | Keep | Test fixture over core state |
| `testkit: rendererBaseCheckout` | terminal | Keep | Core's worktree service |
| `testkit: setRunBridge` | terminal | Keep | Core's run-target route, bridged to whichever plugin runs targets |
| `ui/host: Drawer` | terminal | Keep | Closed-kit component or its type |
| `ui: SplitHandle` | terminal | Keep | Closed-kit component or its type |
| `ui: createSplitDrag` | terminal | Keep | Kit helper or design token; core renders with it too |
| `node: DEFAULT_PROFILE_ID` | workflows | Moved | Named a profile the agents plugin registers. Agents now publishes `agents.defaultProfile`, and workflows reads it through `RunnerDeps.defaultProfileId` |
| `client: AttentionItem` | workflows | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: AttentionSourceContribution` | workflows | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: BindingCandidate` | workflows | Keep | Core feature a plugin reads; core uses it too |
| `client: BindingOrigin` | workflows | Keep | Core feature a plugin reads; core uses it too |
| `client: ProjectSurfaceContribution` | workflows | Keep | Contribution type of the project surface registry |
| `client: contextMenuRegistry` | workflows | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: deviceStorage` | workflows | Keep | Kit helper or design token; core renders with it too |
| `client: openRepoConfigTrust` | workflows | Keep | Core feature a plugin reads; core uses it too |
| `client: projectSurfaceRegistry` | workflows | Keep | Host registry, its contribution type, or its lookup; one contributor so far |
| `client: refreshSessionSources` | workflows | Keep | Core feature a plugin reads; core uses it too |
| `client: wsOnWorkflowStepChanged` | workflows | Keep | Workflows' socket frame, parsed in core's socket client. Moving it means the Node sends it on a plugin channel, a wire change this phase leaves alone |
| `node: Extension` | workflows | Keep | Plugin host type or registry |
| `node: ExtensionPointId` | workflows | Keep | Plugin host type or registry |
| `node: HeadlessOpts` | workflows | Keep | Core's one-shot headless runner |
| `node: ProjectRef` | workflows | Keep | Core service or its type |
| `node: ScheduleSkipped` | workflows | Keep | Core server seam; core uses it too |
| `node: buildHeadlessArgv` | workflows | Keep | Core's one-shot headless runner |
| `node: isDir` | workflows | Keep | Core server seam; core uses it too |
| `node: readConfigFileSync` | workflows | Keep | Core service or its type |
| `node: requireProfile` | workflows | Keep | Core's agent profile lookups |
| `node: runHeadless` | workflows | Keep | Core's one-shot headless runner |
| `testkit/client: provideClientCapability` | workflows | Keep | Test fixture over core state |
| `ui/data-sources: AuthoringConversation` | workflows | Keep | Core feature a plugin reads; core uses it too |
| `ui/data-sources: AuthoringConversationProps` | workflows | Keep | Props of core's data source authoring component |
| `ui/data-sources: SourceQueryEditor` | workflows | Keep | Core feature a plugin reads; core uses it too |
| `ui/data-sources: TypedBindingPicker` | workflows | Keep | Core feature a plugin reads; core uses it too |
| `ui/host: PromoteToTaskModal` | workflows | Keep | Core feature a plugin reads; core uses it too |
| `ui: Graph` | workflows | Keep | Closed-kit component or its type |
| `ui: GraphCard` | workflows | Keep | Closed-kit component or its type |
| `ui: ModalActions` | workflows | Keep | Closed-kit component or its type |
| `ui: ModalBody` | workflows | Keep | Closed-kit component or its type |
| `ui: ToolbarSpacer` | workflows | Keep | Closed-kit component or its type |
| `ui/tree: createArmedConfirm` | none | Deleted | No tree bundle used it. The terminal kit imports it from client-core directly |
| `ui/tree: Rectangle` | none | Keep | Closed-kit node on the tree path. Same exemption as the `ui` kit nodes |
| `ui: DiffLine` | none | Keep | Closed-kit node no compiled plugin draws yet. The support matrix test holds the kit list, so the new check exempts kit nodes |
| `ui: Fallback` | none | Keep | Closed-kit node no compiled plugin draws yet. The support matrix test holds the kit list, so the new check exempts kit nodes |
| `ui: FileHead` | none | Keep | Closed-kit node no compiled plugin draws yet. The support matrix test holds the kit list, so the new check exempts kit nodes |
| `ui: Grid` | none | Keep | Closed-kit node no compiled plugin draws yet. The support matrix test holds the kit list, so the new check exempts kit nodes |
| `ui: KeyValueEditor` | none | Keep | Closed-kit node no compiled plugin draws yet. The support matrix test holds the kit list, so the new check exempts kit nodes |
| `ui: NonCodeRow` | none | Keep | Closed-kit node no compiled plugin draws yet. The support matrix test holds the kit list, so the new check exempts kit nodes |
| `ui: Pane` | none | Keep | Closed-kit node no compiled plugin draws yet. The support matrix test holds the kit list, so the new check exempts kit nodes |
| `ui: PickerRow` | none | Keep | Closed-kit node no compiled plugin draws yet. The support matrix test holds the kit list, so the new check exempts kit nodes |
| `ui: SplitCell` | none | Keep | Closed-kit node no compiled plugin draws yet. The support matrix test holds the kit list, so the new check exempts kit nodes |
