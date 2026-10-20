import { pageDataRecords, type PluginFetchHandler } from '@acorn/plugin-api/node'
import { dataSourceRequestSchema } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import type { AgentSession } from '../../contract/wire.ts'
import type { ManagedAgentRuntime } from '../sessions/runtime'
import { sessionSourceDescription } from '../../shared/sessionSource'
import { AGENT_PANE_ID } from '../../shared/paneIdentity'

export function createSessionSourceHandler(runtime: ManagedAgentRuntime): PluginFetchHandler {
  return async (request, context) => {
    try {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
      if (
        context.principal.kind !== 'device' &&
        !(context.principal.kind === 'internal' && context.principal.scope === 'service')
      ) {
        return Response.json({ error: 'forbidden' }, { status: 403 })
      }
      const input = dataSourceRequestSchema.parse(await request.json())
      if (input.operation === 'describe') return Response.json(sessionSourceDescription)
      if (input.operation !== 'query') return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      // The store pages at 100. Filter and sort need the whole selection, so read it all, up to the
      // host's record budget, and say so when the budget stops the read.
      // Every page request rereads the selection. Cache it per query if sessions grow past a few thousand.
      const sessions: AgentSession[] = []
      let cursor: string | null = null
      do {
        const page = await runtime.store.listSessions({
          archived: false,
          ...(input.query.scope.workspaceId ? { workspaceId: input.query.scope.workspaceId } : {}),
          limit: 100,
          cursorFormat: 'tuple-v1',
          ...(cursor ? { cursor } : {}),
        })
        sessions.push(...page.sessions)
        cursor = page.nextCursor ?? null
      } while (cursor && sessions.length < DATA_LIMITS.selectionRecords)
      const truncated = cursor !== null
      const records = sessions.map((session) => ({
        recordId: session.id,
        data: {
          title: session.title || session.providerId,
          state: session.runtimeState,
          attention: session.attention,
          provider: session.providerId,
          model: session.model ?? null,
          taskId: session.taskId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
        display: { title: session.title || session.providerId },
        taskId: session.taskId,
        action: { verb: 'openPane' as const, pane: AGENT_PANE_ID },
        target: { kind: 'agents.session', item: session.id },
      }))
      return Response.json({
        ...pageDataRecords(input, { records, truncated }),
        revision: sessionSourceDescription.revision,
        readTime: input.evaluationTime,
      })
    } catch {
      return Response.json({ error: 'agent_session_source_failed' }, { status: 502 })
    }
  }
}
