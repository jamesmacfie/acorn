// The published node-side API is a type-only entrypoint. Keep names here and declarations in their
// owning contract modules. The declaration build emits this as dist/index.d.ts and its local imports
// as sibling files, so a packed consumer needs only this package and @types/node.
//
// contract.test.ts compares the hand-written shapes with the host. The published surface snapshot
// guards the exported names and members. Some host-owned shapes remain deliberately opaque where
// describing them would add a dependency or duplicate a different contract.

export type { HostOwned } from './contracts/shared.js'
export type {
  PluginToolJsonSchema,
  PluginAgentToolDescriptor,
  PluginContextSectionDescriptor,
  PluginCliCommandDescriptor,
} from './contracts/manifest.js'
export type { NodePlugin, NodePluginContext } from './contracts/context.js'
export type {
  PluginRouteOptions,
  PluginFetchHandler,
  PluginRouteRegistry,
  PluginRequestContext,
  Principal,
  RouteFailure,
  RouteResult,
  PluginProviderResourceRequest,
  PluginProviderConnectionVisitor,
  PluginProviderRuntime,
} from './contracts/routes.js'
export type { PluginScheduleRegistry, Cadence, PluginSchedule } from './contracts/schedules.js'
export type { PluginTaskCheckRegistry, PluginTaskCheck } from './contracts/taskChecks.js'
export type {
  PluginProviderRegistry,
  GenerateTextInput,
  GenerateTextUsage,
  ModelProviderAdapterResult,
  ModelProviderAdapter,
} from './contracts/providers.js'
export type {
  Disposable,
  CapabilityId,
  PluginCapabilities,
  CapabilityCatalogue,
  CapabilityIdOf,
} from './contracts/capabilities.js'
export type { PluginRunRegistry } from './contracts/runs.js'
export type { PluginAuditRegistry } from './contracts/audit.js'
export type {
  ExtensionPointId,
  Extension,
  PluginExtensionPointRegistry,
} from './contracts/extensionPoints.js'
export type {
  PluginHookRegistry,
  PluginHookPoint,
  PluginHookHandler,
  HookMode,
  HookPayloadType,
  HookPayloadShape,
  HookPayload,
  HookVerdict,
} from './contracts/hooks.js'
export type { PluginStorage, PluginDatabase } from './contracts/storage.js'
export type { PluginBroadcast, PluginNotice, NodeEventChannel } from './contracts/events.js'
export type { CoreServices } from './contracts/coreServices.js'
export type {
  DataCell,
  DataColumn,
  DataTable,
  DataSchemaSource,
  DataQueryOptions,
  DataQueryResult,
  DataSchemaResult,
  CoreDataService,
} from './contracts/coreData.js'
export type {
  CoreFsService,
  ConfineFailure,
  ConfineResult,
  CoreGitService,
  GitOptions,
  CoreProcService,
  ProcSpec,
  ProcResult,
  CoreSecretService,
} from './contracts/coreSystem.js'
export type {
  TaskRef,
  TaskLinkRef,
  ChildTaskSeed,
  AttachTaskPullInput,
  TaskPullRelation,
  RunTarget,
  LayoutRecipe,
  TaskRunConfig,
  CoreTaskService,
} from './contracts/coreTasks.js'
export type {
  ProjectRef,
  ProjectCreateRefInput,
  ProjectUpdateRefInput,
  SetupTrigger,
  PreviewMode,
  DbSchemaMode,
  BrowserRule,
  ProjectConfig,
  ProjectConfigResponse,
  CoreProjectService,
} from './contracts/coreProjects.js'
export type {
  CoreContextService,
  CoreModelService,
  CorePrefService,
  CoreIdentityService,
} from './contracts/coreMisc.js'
export type { DraftAttachment, DraftAttachmentsCapability } from './contracts/attachments.js'
export type {
  TelemetryAttrs,
  TelemetrySpanHandle,
  TelemetryErrorInput,
  PluginTelemetry,
  Logger,
  CoreTelemetryService,
  TelemetryBatch,
} from './contracts/telemetry.js'
export type {
  DataPrimitive,
  DataSourceRef,
  DataSourceScope,
  DataSourceInput,
  DataSourceInputBinding,
  DataSourceInputHandle,
  DataSourceInputQuery,
  DataSourceInputOptionsRequest,
  DataSourceDescriptor,
  DataSourceCatalog,
  DataSourceDiscoveryRequest,
  DataSourceDiscoveryPage,
  DataSourceRegistration,
  DataSourceDescription,
  DataSourceQuery,
  DataRecordRef,
  DataSourceRequest,
  DataSourceCompleteness,
  DataSourcePage,
  DataRecordAction,
  DataSourceResult,
  DataSourceResponse,
  DataValue,
  VersionedDataValue,
  DataType,
  DataSchema,
  DataBindingAddress,
  DataBinding,
  QueryScope,
  QueryDraft,
  QueryPublicationPlan,
  QueryPublicationRequest,
  QueryPublicationResult,
  QueryContent,
  QueryReference,
  QueryConsumer,
  QueryRevision,
  QueryBindingContext,
  ResolvedQuery,
  DataOperator,
  DataPredicate,
  DataField,
} from './contracts/data.js'
