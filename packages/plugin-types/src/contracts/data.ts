export type DataPrimitive = string | number | boolean | null
export type DataSourceRef = { pluginId: string; sourceId: string }
export type DataSourceScope = { workspaceId?: string; projectId?: string; connectionId?: string; parameters: Record<string, DataValue> }
export type DataSourceDescriptor = {
  sourceId: string; name: string; singular: string; plural: string; identityScope: string
  icon?: string; providerId?: string; titlePointer?: string; urlPointer?: string
}
export type DataSourceCatalog = {
  sources: (DataSourceDescriptor & DataSourceRef)[]
  discoveries: { discoveryId: string; providerId?: string; pluginId: string }[]
}
export type DataSourceDiscoveryRequest = {
  pluginId: string; discoveryId: string; scope: DataSourceScope; cursor?: string; pageSize: number
}
export type DataSourceDiscoveryPage = {
  sources: (DataSourceDescriptor & DataSourceRef)[]; nextCursor?: string; exhausted: boolean
}
export type DataSourceRegistration = DataSourceDescriptor & { handler: string }
export type DataSourceDescription = {
  schema: DataSchema; fields: DataField[]; parameters: DataSchema; parameterFields: DataField[]
  operations: { query: true; options: boolean; details: boolean; incremental: boolean; groups: ('all' | 'any')[]; identity?: boolean }
  detailSchema?: DataSchema; incremental?: { semantics: string }; revision: string; consistency: string
  dataset?: { mode: 'current-mirror' | 'event-archive' | 'snapshot-history'; feeder: 'capture' | 'workflow' | 'agent' }
  coverageWindows?: { fromTime: number; toTime: number; kind: 'complete' | 'gap'; reason: string | null }[]
  reach?: { parameter: string; itemPlural: string; default: string; empty: string }
  coverage?: { kind: 'snapshot' } | { kind: 'events'; retention?: string; earliestTime?: number; complete: boolean }
  starterPlans?: unknown[]
  actions?: { id: string; label: string; icon?: string; risk: 'read' | 'write' | 'execute' }[]
  writable?: { field: string; path: string; risk: 'read' | 'write' | 'execute'; values: DataValue[] }[]
  targets?: { kind: string }[]
}
export type DataSourceQuery = {
  source: DataSourceRef; scope: DataSourceScope; predicate?: DataPredicate
  sort: { pointer: string; direction: 'asc' | 'desc' }[]; take?: number
  incremental?: { kind: 'baseline' } | { kind: 'continue'; boundary: DataValue }
}
export type DataRecordRef = DataSourceRef & { connectionId?: string; recordId: string; scope?: DataSourceScope }
export type DataSourceRequest =
  | { operation: 'describe'; source: DataSourceRef; scope: DataSourceScope }
  | { operation: 'identity'; source: DataSourceRef; scope: DataSourceScope }
  | { operation: 'options'; source: DataSourceRef; scope: DataSourceScope; target: 'field' | 'parameter'; pointer: string; search: string; cursor?: string; pageSize: number }
  | { operation: 'query'; query: DataSourceQuery; mode: 'preview' | 'execution'; evaluationTime: number; cursor?: string; pageSize: number; timeoutMs?: number }
  | { operation: 'details'; ref: DataRecordRef; scope: DataSourceScope; projection: string[] }
  | { operation: 'actions'; ref: DataRecordRef; scope: DataSourceScope }
export type DataSourceCompleteness = { kind: 'more'; cursor: string } | { kind: 'complete' } | { kind: 'bounded' } | { kind: 'incomplete'; cause: 'upstream-cap' | 'provider-failure' | 'host-budget' | 'coverage-gap' }
export type DataSourcePage = {
  records: { recordId: string; data: DataValue; display?: { title?: string; url?: string }; taskId?: string; action?: DataRecordAction; actions?: NamedDataRecordAction[]; writableFields?: string[]; target?: { kind: string; item: string } }[]
  revision: string; readTime: number; completeness: DataSourceCompleteness; incrementalBoundary?: DataValue
  eventCoverage?: { fromTime: number; toTime: number }[]
  coveredRange?: { start: number; end: number }; observedAt?: number
}
export type DataRecordAction = ({ verb: 'openPane'; pane: string } | { verb: 'openTask' }
  | { verb: 'runNodeAction'; path: string } | { verb: 'openUrl'; url: string }
  | { verb: 'openOverlay'; overlay: string } | { verb: 'surfaceAction'; surface: string }
  | { verb: 'navigate'; surface: string } | { verb: 'createTask' }) & { risk?: 'read' | 'write' | 'execute' }
export type NamedDataRecordAction = { id: string; label: string; icon?: string; risk: 'read' | 'write' | 'execute'; action: DataRecordAction }
export type DataSourceResult = Omit<DataSourcePage, 'records'> & {
  records: (Omit<DataSourcePage['records'][number], 'recordId'> & { ref: DataRecordRef })[]
  mode: 'preview' | 'execution'; evaluationTime: number
}
export type DataSourceResponse<R extends DataSourceRequest> = R extends { operation: 'describe' } ? DataSourceDescription
  : R extends { operation: 'identity' } ? DataSourceIdentity
  : R extends { operation: 'options' } ? { options: { id: string; label: string }[]; nextCursor?: string; exhausted: boolean }
    : R extends { operation: 'query' } ? DataSourceResult
      : R extends { operation: 'actions' } ? { actions: NamedDataRecordAction[] }
        : { kind: 'found'; data: DataValue; fetchedTime: number; writableFields?: string[] } | { kind: 'not-found' }
export type DataValue = DataPrimitive | DataValue[] | { [key: string]: DataValue }
export type DataSourceIdentity = { id?: string; login?: string; name?: string; email?: string; teamIds?: string[]; teams?: { id: string; name: string }[] }
export type VersionedDataValue = { version: 1; value: DataValue }
export type DataType = 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array'
export type DataSchema = {
  type: DataType | [Exclude<DataType, 'null'>, 'null']
  properties?: Record<string, DataSchema>
  required?: string[]
  items?: DataSchema
  enum?: DataPrimitive[]
  additionalProperties?: boolean
}
export type DataBindingAddress =
  | { from: 'literal'; value: DataValue }
  | { from: 'input'; name: string; pointer: string }
  | { from: 'step'; stepId: string; pointer: string }
  | { from: 'item'; pointer: string }
  | { from: 'context'; name: 'viewer'; pointer: string }
  | { from: 'context'; name: 'workspaceLinks' }
  | { from: 'context'; name: 'now'; offset?: string }
  | { from: 'context'; name: 'calendar'; boundary: 'startOfDay' | 'startOfWeek' | 'startOfMonth'; offset?: string }
export type DataBinding = { address: DataBindingAddress; fallback?: DataValue; conversion?: 'scalar-to-text' | 'json-to-text' }
export type QueryScope = { workspaceId: string; projectId?: string }
export type QueryDraft = QueryScope & { id: string; content: QueryContent; draftRevision: number; basePublishedRevision: number | null; publishedRevision: number | null; createdAt: number; updatedAt: number }
export type QueryPublicationPlan = { draft: QueryDraft; intendedRevision: number; sourceRevision: string }
export type QueryPublicationRequest = QueryScope & (
  | { action: 'inspect'; queryId: string }
  | { action: 'prepare'; queryId: string; expectedRevision: number; parameters: Record<string, DataValue> }
  | { action: 'hold' | 'write'; operationId: string; plan: QueryPublicationPlan }
  | { action: 'release' | 'abandon'; operationId: string })
export type QueryPublicationResult = { draft?: QueryDraft; published?: QueryRevision; plan?: QueryPublicationPlan; consumers?: QueryConsumer[] }
export type QueryContent = {
  name: string
  parameters: DataSchema
  query: DataSourceQuery
  sourceParameters: Record<string, DataBinding>
  connection?: DataBinding
}
export type QueryReference =
  | { kind: 'inline'; content: QueryContent; bindings: Record<string, DataBinding> }
  | { kind: 'saved'; queryId: string; revision?: number; bindings: Record<string, DataBinding> }
export type QueryConsumer = { pluginId: string; kind: 'panel' | 'workflow' | 'schedule'; id: string; name: string; href: string }
export type QueryRevision = QueryScope & { queryId: string; revision: number; content: QueryContent; digest: string; sourceRevision: string; createdAt: number }
export type QueryBindingContext = { evaluationTime?: number; timePolicy?: { zone: string; weekStart: 'monday' | 'sunday' | 'saturday' }; viewer?: DataSourceIdentity; workspaceLinks?: string[]; inputs?: Record<string, DataValue>; steps?: Record<string, DataValue>; item?: DataValue }
export type ResolvedQuery = { query: DataSourceQuery; parameters: Record<string, DataValue>; published?: QueryRevision }
export type DataOperator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'in' | 'missing' | 'present'
export type DataPredicate =
  | { kind: 'all' | 'any'; predicates: DataPredicate[] }
  | { kind: 'comparison'; left: DataBinding; operator: DataOperator; right?: DataBinding }
export type DataField = {
  pointer: string
  label: string
  description?: string
  origin: 'declared' | 'dynamic' | 'observed'
  display?: {
    kind: 'text' | 'number' | 'boolean' | 'datetime' | 'enum' | 'status' | 'person' | 'link'
    precision?: 'day'; list?: boolean
    unit?: string
    role?: 'title' | 'status' | 'assignee' | 'url' | 'updated'
  }
  query?: { operators: DataOperator[]; sortable: boolean }
  choices?: { kind: 'static'; values: { id: string; label: string; tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'accent'; rank?: number }[] } | { kind: 'dynamic'; dependsOn: string[] }
  viewerMatch?: string
}
