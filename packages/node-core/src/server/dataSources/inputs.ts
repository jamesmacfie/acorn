// Host-mediated reads for derived sources: a source that declares other sources as inputs. Acorn
// reads each input for the plugin, with the account the query bound, and hands the plugin read-only
// handles on its request context. The plugin never sees a credential, can't run an action through an
// input, and can't read a source it didn't declare.
// See docs/data-sources/derived-sources.md § Read through the host.
//
// The runtime passes its own `invokeDataSource` in, so every input read gets the same admission,
// description, validation, and provider scheduling as a direct read, and this module stays out of an
// import cycle with ./runtime.ts.
import { createHash } from 'node:crypto'
import { DATA_SOURCE_PREVIEW_MODE, parseDataSourceInputRef, type DataSourceDescription, type DataSourceRequest, type DataSourceResponse, type DataSourceResult } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import type { Env } from '../bindings'
import type { DataSourceInputHandle } from '../pluginHost/types'
import { grantCoversInput, inputGrantsStore } from '../plugins/inputGrants'
import { inputScope, type DataSourceInvocation } from './authority'
import type { RegisteredDataSource } from './registry'
import { DataSourceError } from './validation'

type Invoke = <R extends DataSourceRequest>(env: Env, request: R, invocation: DataSourceInvocation) => Promise<DataSourceResponse<R>>
type IncompleteCause = Extract<DataSourceResult['completeness'], { kind: 'incomplete' }>['cause']

/** What one invocation of a derived source learned from its input reads and its own records.
 *  `inputError` is the first input read that failed, so a handler that fails because of it reports
 *  the input's cause rather than a bare provider failure. */
export type DerivedReadState = { inputIncomplete?: IncompleteCause; droppedRecords: number; inputError?: DataSourceError }

const MAX_DERIVED_DEPTH = 2
const sourceKey = (source: RegisteredDataSource) => `${source.pluginId}:${source.sourceId}`

/** Refuse a read that would revisit a derived source already in the chain, or nest too deep. */
export function checkInputChain(source: RegisteredDataSource, invocation: DataSourceInvocation): void {
  const chain = invocation.chain ?? []
  if (chain.includes(sourceKey(source))) throw new DataSourceError('invalid-request', { reason: 'Inputs form a loop' })
  if (source.inputs && chain.length >= MAX_DERIVED_DEPTH) {
    throw new DataSourceError('invalid-request', { reason: `Inputs nest more than ${MAX_DERIVED_DEPTH} derived sources deep` })
  }
}

/** One handle per bound input. Each call runs a full source invocation for the input with the bound
 *  scope, under the outer invocation's signal, so the panel's time budget covers both. */
export function inputHandles(
  env: Env,
  source: RegisteredDataSource,
  request: DataSourceRequest,
  invocation: DataSourceInvocation,
  state: DerivedReadState,
  invoke: Invoke,
): Record<string, DataSourceInputHandle> | undefined {
  if (!source.inputs) return undefined
  const scope = request.operation === 'query' ? request.query.scope : request.scope
  const child: DataSourceInvocation = { ...invocation, chain: [...invocation.chain ?? [], sourceKey(source)] }
  const timing = request.operation === 'query'
    ? { mode: request.mode, evaluationTime: request.evaluationTime }
    : { mode: DATA_SOURCE_PREVIEW_MODE, evaluationTime: Date.now() }
  const handles: Record<string, DataSourceInputHandle> = {}
  for (const [name, input] of Object.entries(source.inputs)) {
    const binding = scope.inputs?.[name]
    if (!binding) continue
    const ref = parseDataSourceInputRef(input.source)
    const bound = inputScope(scope, binding)
    // Checked at each read rather than once, so an approval or a revocation takes effect mid-session.
    // This reads input-grants.json on every call. Cache it in memory if a derived source reads hot.
    const admit = () => {
      if (source.loaded && !grantCoversInput(inputGrantsStore(env.DATA_DIR).get(source.pluginId), source.sourceId, name, input)) {
        throw new DataSourceError('input-unavailable', { input: name, reason: 'Not approved' })
      }
    }
    const read = async <R extends DataSourceRequest>(request: R): Promise<DataSourceResponse<R>> => {
      try {
        admit()
        return await invoke(env, request, child)
      } catch (error) {
        if (error instanceof DataSourceError) state.inputError ??= error
        throw error
      }
    }
    handles[name] = {
      describe: () => read({ operation: 'describe', source: ref, scope: bound }),
      identity: () => read({ operation: 'identity', source: ref, scope: bound }),
      options: ({ target, pointer, search, cursor, pageSize }) => read({ operation: 'options', source: ref, scope: bound,
        target, pointer, search: search ?? '', ...(cursor ? { cursor } : {}), pageSize: pageSize ?? DATA_LIMITS.options }),
      query: async ({ predicate, sort, take, cursor, pageSize } = {}) => {
        const result = await read({ operation: 'query', ...timing,
          query: { source: ref, scope: bound, sort: sort ?? [], ...(predicate ? { predicate } : {}), ...(take ? { take } : {}) },
          ...(cursor ? { cursor } : {}), pageSize: pageSize ?? DATA_LIMITS.previewRecords })
        if (result.completeness.kind === 'incomplete') state.inputIncomplete ??= result.completeness.cause
        return result
      },
    }
  }
  return handles
}

/** A derived source's revision changes when its own does or when any bound input's does, so a change
 *  upstream invalidates cached descriptions and runs. The plugin only ever reports its own. */
export async function composeDerivedRevision(
  env: Env,
  source: RegisteredDataSource,
  description: DataSourceDescription,
  scope: Extract<DataSourceRequest, { operation: 'describe' }>['scope'],
  invocation: DataSourceInvocation,
  invoke: Invoke,
): Promise<string> {
  const child: DataSourceInvocation = { ...invocation, chain: [...invocation.chain ?? [], sourceKey(source)] }
  const parts: [string, string][] = []
  for (const [name, input] of Object.entries(source.inputs ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const binding = scope.inputs?.[name]
    if (!binding) continue
    const upstream = await invoke(env, { operation: 'describe', source: parseDataSourceInputRef(input.source), scope: inputScope(scope, binding) }, child)
    parts.push([name, upstream.revision])
  }
  const digest = createHash('sha256').update(JSON.stringify([description.revision, parts])).digest('base64url').slice(0, 22)
  return `derived.${digest}`
}

/** Fold what the input reads and record checks learned into the page the caller sees. The plugin's
 *  own `incomplete` wins, then an input's cause, then the count of records dropped for their shape. */
export function finishDerivedResult(result: DataSourceResult, state: DerivedReadState): DataSourceResult {
  if (result.completeness.kind !== 'complete' && result.completeness.kind !== 'bounded') return result
  if (state.inputIncomplete) return { ...result, completeness: { kind: 'incomplete', cause: state.inputIncomplete } }
  if (state.droppedRecords) return { ...result, completeness: { kind: 'incomplete', cause: 'invalid-records', count: state.droppedRecords } }
  return result
}
