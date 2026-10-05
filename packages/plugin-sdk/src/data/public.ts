// Published declaration, hand-written and copied verbatim to dist/data.d.ts. See
// docs/plugin-authoring/derived-sources.md for the walkthrough. The implementation in ./derived.ts
// imports its types from here, and contract.test.ts holds the two together.
import type {
  DataField, DataPrimitive, DataRecordAction, DataRecordRef, DataSchema, DataSourceDescription, DataSourceInput,
  DataSourceInputHandle, DataSourceQuery, DataSourceRegistration, DataSourceRequest, DataSourceResult, DataValue, PluginFetchHandler,
} from 'acorn-plugin-types'

// ── Fields ────────────────────────────────────────────────────────────────────────────────────────

export type FieldOptions = {
  label: string
  description?: string
  role?: 'title' | 'status' | 'assignee' | 'url' | 'updated'
  unit?: string
  /** Show a datetime as a date. */
  precision?: 'day'
  /** The value is a list of the type. */
  list?: boolean
  /** The value may be null, for a row that has none. */
  nullable?: boolean
}
export type FieldChoice = { id: string; label: string; tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'accent'; rank?: number }

/** The value a record carries for a field with these options. */
export type FieldValue<T, O extends FieldOptions> = (O['list'] extends true ? readonly T[] : T) | (O['nullable'] extends true ? null : never)

/** One declared field. The metadata and the JSON schema are built together, so they can't disagree.
 *  `value` exists only for the compiler: it's how a record's type follows from its fields. */
export type FieldSpec<T> = { readonly field: Omit<DataField, 'pointer'>; readonly schema: DataSchema; readonly value?: T }
export type FieldSpecs = Record<string, FieldSpec<unknown>>
export type FieldValues<F extends FieldSpecs> = { [K in keyof F]: F[K] extends FieldSpec<infer T> ? T : never }

/** Field builders. A datetime is milliseconds since the epoch. A person and a link are text. */
export declare const field: {
  text<const O extends FieldOptions>(options: O): FieldSpec<FieldValue<string, O>>
  number<const O extends FieldOptions>(options: O): FieldSpec<FieldValue<number, O>>
  boolean<const O extends FieldOptions>(options: O): FieldSpec<FieldValue<boolean, O>>
  datetime<const O extends FieldOptions>(options: O): FieldSpec<FieldValue<number, O>>
  choice<const O extends FieldOptions & { choices: readonly FieldChoice[] }>(options: O): FieldSpec<FieldValue<O['choices'][number]['id'], O>>
  person<const O extends FieldOptions>(options: O): FieldSpec<FieldValue<string, O>>
  link<const O extends FieldOptions>(options: O): FieldSpec<FieldValue<string, O>>
}

// ── Inputs ────────────────────────────────────────────────────────────────────────────────────────

export type InputSpecs = Record<string, DataSourceInput>
/** One record an input returned. Every source's records are objects. */
export type InputRecord = {
  ref: DataRecordRef
  data: { readonly [key: string]: DataValue | undefined }
  display?: { title?: string; url?: string }
  taskId?: string
  action?: DataRecordAction
}
export type InputQuery = {
  /** Field equality tests, such as `{ state: 'open' }`. A key is a field name or a pointer. The input
   *  source must support `eq` on each field. */
  where?: Record<string, DataPrimitive>
  sort?: DataSourceQuery['sort']
  take?: number
}
export type InputRead = { records: InputRecord[]; completeness: DataSourceResult['completeness'] }
/** A read-only handle on one input. Acorn runs each read with the account the panel chose. */
export type InputHandle = {
  describe: DataSourceInputHandle['describe']
  identity: DataSourceInputHandle['identity']
  /** One page. Pass the cursor from a `more` completeness for the next. */
  query(query?: InputQuery & { cursor?: string; pageSize?: number }): Promise<InputRead>
  /** Every page, until the input is exhausted or the read reaches 5,000 records. A read cut short
   *  marks this source's page incomplete. */
  all(query?: InputQuery): Promise<InputRead>
}
/** An optional input the person skipped is `undefined`, so the compiler makes you handle it. */
export type InputHandles<I extends InputSpecs> = { [K in keyof I]: I[K]['optional'] extends true ? InputHandle | undefined : InputHandle }

// ── The source ────────────────────────────────────────────────────────────────────────────────────

/** One row your logic returns. `opens` is an input record's `ref`: pressing the row opens that record. */
export type DerivedRecord<F extends FieldSpecs> = { id: string; data: FieldValues<F>; opens?: DataRecordRef }
export type DerivedQueryArgs<I extends InputSpecs, P extends FieldSpecs> = {
  inputs: InputHandles<I>
  parameters: FieldValues<P>
  evaluationTime: number
  mode: Extract<DataSourceRequest, { operation: 'query' }>['mode']
  signal: AbortSignal
}

export type DerivedSourceDefinition<I extends InputSpecs, F extends FieldSpecs, P extends FieldSpecs> = {
  /** The source id, unique within your plugin. */
  id: string
  name: string
  singular: string
  plural: string
  /** The route that serves this source, inside your namespace: `/v1/p/<pluginId>/...`. */
  handler: string
  inputs: I
  fields: F
  parameters?: P
  icon?: string
  /** What makes a record's id stable. Defaults to "Built from its inputs". */
  identityScope?: string
  /** How fresh the data is. Defaults to a sentence saying it's read from the inputs each time. */
  consistency?: string
  starterPlans?: unknown[]
  query(args: DerivedQueryArgs<I, P>): DerivedRecord<F>[] | Promise<DerivedRecord<F>[]>
}

export type DerivedSource<I extends InputSpecs, F extends FieldSpecs, P extends FieldSpecs> = {
  readonly definition: DerivedSourceDefinition<I, F, P>
  /** What `describe` answers, before the host composes in the inputs' revisions. */
  readonly description: DataSourceDescription
  /** Serve it on the manifest's handler route: `ctx.routes.fetch(source.fetch)`. */
  readonly fetch: PluginFetchHandler
}

/** Answers every source operation from the declared fields, checks every record, and calls `query`
 *  for your logic. */
export declare function defineDerivedSource<const I extends InputSpecs, const F extends FieldSpecs, const P extends FieldSpecs = {}>(
  definition: DerivedSourceDefinition<I, F, P>,
): DerivedSource<I, F, P>

/** The `contributions.dataSources` entry for the manifest, inputs included, so the two can't disagree. */
export declare function derivedSourceManifest(source: DerivedSource<InputSpecs, FieldSpecs, FieldSpecs>): DataSourceRegistration
