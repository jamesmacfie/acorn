// Published declaration, hand-written and copied verbatim to dist/testing.d.ts. Runs under any test
// runner. See docs/plugin-authoring/testing.md § Test a derived source.
import type { DataRecordAction, DataSourceResult } from 'acorn-plugin-types'
import type { DerivedQueryArgs, DerivedSource, FieldSpecs, FieldValues, InputRecord, InputSpecs } from 'acorn-plugin-sdk/data'

/** Records for each input, by input name. An optional input you leave out is one the person skipped. */
export type TestInputs<I extends InputSpecs> =
  & { [K in keyof I as I[K]['optional'] extends true ? never : K]: InputRecord[] }
  & { [K in keyof I as I[K]['optional'] extends true ? K : never]?: InputRecord[] }

export type TestRow<F extends FieldSpecs> = { id: string; data: FieldValues<F>; action?: DataRecordAction; taskId?: string; display?: { url?: string } }
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
