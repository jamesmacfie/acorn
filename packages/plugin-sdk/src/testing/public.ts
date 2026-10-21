// Published declaration, hand-written and copied verbatim to dist/testing.d.ts. Runs under any test
// runner. See docs/plugin-authoring/testing.md § Test a derived source.
import type {
  DataPredicate,
  DataRecordAction,
  DataSourceCompleteness,
  DataSourceDescription,
  DataSourceResult,
  DataValue,
  RecordChange,
} from 'acorn-plugin-types'
import type {
  DerivedQueryArgs,
  DerivedSource,
  FieldSpecs,
  FieldValues,
  InputRecord,
  InputSpecs,
} from 'acorn-plugin-sdk/data'

/** Records for each input, by input name. An optional input you leave out is one the person skipped. */
export type TestInputs<I extends InputSpecs> = {
  [K in keyof I as I[K]['optional'] extends true ? never : K]: InputRecord[]
} & { [K in keyof I as I[K]['optional'] extends true ? K : never]?: InputRecord[] }

export type TestRow<F extends FieldSpecs> = {
  id: string
  data: FieldValues<F>
  action?: DataRecordAction
  taskId?: string
  display?: { url?: string }
}
export type TestResult<F extends FieldSpecs> = {
  rows: TestRow<F>[]
  /** Records that failed the declared fields, which the app drops and counts the same way. */
  dropped: { id: string; reason: string }[]
  completeness: DataSourceResult['completeness']
}

/** Run a source's `query` against fake input handles, with the same record checks the app applies.
 *  A fake input returns your records in the order you gave them and applies `where` itself. */
export declare function testDerivedSource<I extends InputSpecs, F extends FieldSpecs, P extends FieldSpecs>(
  source: DerivedSource<I, F, P>,
  inputs: TestInputs<I>,
  options?: { parameters?: FieldValues<P>; evaluationTime?: number; mode?: DerivedQueryArgs<I, P>['mode'] },
): Promise<TestResult<F>>

/** Input records for a built-in or first-party source, `'<pluginId>:<sourceId>'`, built from its real
 *  field list. Fields you leave out get typed defaults. A field the source doesn't have throws. */
export declare function fixtures(source: string, records: readonly Record<string, unknown>[]): InputRecord[]

// ── Triggers ──────────────────────────────────────────────────────────────────────────────────────

/** Throws with each suggested trigger's problems: the ones the Node would drop. */
export declare function checkStarterTriggers(description: DataSourceDescription): void

/** One record a read returned: its id and its data, `time` included for a feed. */
export type TriggerRecord = { id: string; data: { readonly [key: string]: DataValue } }
/** One check's read. A plain list is a complete read. Only a complete read says which records stopped
 *  matching, so an incomplete one never lets a record start matching again. */
export type TriggerRead =
  | readonly TriggerRecord[]
  | { records: readonly TriggerRecord[]; completeness: DataSourceCompleteness }
/** What one check would start: each record, in read order, and the rule that admitted it. */
export type TriggerCheck = { starts: { id: string; reason: RecordChange['on'] }[] }

/** Runs a record trigger's change rule over a sequence of reads, the way the Node's check does, and
 *  returns what each read would start. `change` and `predicate` point into the source's records, as a
 *  suggested trigger's do. With `predicate`, each read is filtered first, as the source would. Every
 *  run is taken to have finished before the next read, and the trigger's caps aren't applied. */
export declare function testTrigger(
  description: DataSourceDescription,
  change: RecordChange,
  reads: readonly TriggerRead[],
  options?: { predicate?: DataPredicate },
): TriggerCheck[]
