import { z } from 'zod'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { dataRecordRefSchema, dataSourceScopeSchema, type DataRecordRef } from '@acorn/protocol/dataSources.ts'
import { gh, ghError, ghGraphQL, ghGraphQLResult } from '../githubApi'

type Context = Parameters<PluginFetchHandler>[1]
type Pull = { state: 'OPEN' | 'CLOSED' | 'MERGED'; number: number;
  repository: { name: string; owner: { login: string } } }

async function withPull<T>(ref: DataRecordRef, context: Context, use: (token: string, pull: Pull) => Promise<T>): Promise<T | undefined> {
  if (!ref.connectionId || ref.scope?.connectionId !== ref.connectionId || ref.pluginId !== 'github' || ref.sourceId !== 'pull-requests') return undefined
  const results = await context.providers.withConnections('github', async (connection, token) => {
    if (connection.id !== ref.connectionId || connection.status !== 'connected') return undefined
    const response = await ghGraphQL(token,
      'query($id:ID!){node(id:$id){... on PullRequest{state number repository{name owner{login}}}}}',
      { id: ref.recordId })
    const result = await ghGraphQLResult<{ node: Pull | null }>(response)
    if (!result.ok || !result.data.node) return undefined
    return use(token, result.data.node)
  })
  return results[0]
}

export async function pullStateDetails(ref: DataRecordRef, context: Context): Promise<Response> {
  const result = await withPull(ref, context, async (_token, pull) => ({ kind: 'found' as const,
    data: { state: pull.state.toLowerCase() }, fetchedTime: Date.now(),
    writableFields: pull.state === 'MERGED' ? [] : ['/state'] }))
  return result ? Response.json(result) : Response.json({ kind: 'not-found' })
}

const write = z.strictObject({
  ref: dataRecordRefSchema.extend({ pluginId: z.literal('github'), sourceId: z.literal('pull-requests'),
    connectionId: z.string(), scope: dataSourceScopeSchema }),
  field: z.literal('/state'), expected: z.enum(['open', 'closed', 'merged']), target: z.enum(['open', 'closed']),
  idempotencyKey: z.string().uuid(),
})

/** The source's confined route checks the live provider state again before its existing PATCH operation. */
export async function writePullState(request: Request, context: Context): Promise<Response> {
  if (context.principal.kind !== 'device') return Response.json({ error: 'forbidden' }, { status: 403 })
  const parsed = write.safeParse(await request.json().catch(() => null))
  if (!parsed.success || parsed.data.ref.scope.connectionId !== parsed.data.ref.connectionId) return Response.json({ error: 'invalid_request' }, { status: 400 })
  const { ref, expected, target } = parsed.data
  const result = await withPull<Response>(ref, context, async (token, pull) => {
    if (pull.state === 'MERGED') return Response.json({ outcome: 'not-writable' })
    if (pull.state.toLowerCase() !== expected || expected === target) return Response.json({ outcome: 'stale' })
    const owner = encodeURIComponent(pull.repository.owner.login)
    const repo = encodeURIComponent(pull.repository.name)
    const response = await gh(token, `/repos/${owner}/${repo}/pulls/${pull.number}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: target }),
    })
    const error = ghError(response)
    return error ? Response.json({ error: error.error }, { status: error.status }) : Response.json({ outcome: 'done' })
  })
  return result ?? Response.json({ error: 'not_found' }, { status: 404 })
}
