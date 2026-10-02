import { Hono } from 'hono'
import {
  authoringSystemPrompt,
  authoringTurnRequestSchema,
  runAuthoringTurn,
  type AuthoringTurnRequest,
} from '@acorn/protocol/authoring.ts'
import { dashboardPanelContentSchema } from '@acorn/protocol/dashboards.ts'
import { queryContentSchema } from '@acorn/protocol/dataQueries.ts'
import { createModelService } from '../core/models'
import { authoringMetadata } from '../authoring/metadata'
import { dashboardContentProblems } from '../dashboards/publication'
import { describeDashboardProblem } from '@acorn/dashboards-core/projection'
import { getDb } from '../db'
import type { AppEnv } from '../middleware/auth'
import { ownerId } from '../middleware/requireUser'
import { ProviderOperationError } from '../integrations/types'
import { resolveQuery } from '../queries/runtime'
import { respondError } from '../respond'
import { createLogger } from '../telemetry/logger'

const log = createLogger('authoring')

const TARGET_PROMPTS = {
  query: 'The candidate must be one QueryContent object. Keep typed predicates and exact source option ids. Ask for metadata before naming a source, field, operator, connection, or option.',
  dashboard: 'The candidate must be one DashboardPanelContent object. Keep independently identified queries, exact status ids, mappings, and display settings. Ask for metadata before naming source facts.',
} as const

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Candidate validation failed.'
}

export const authoring = new Hono<AppEnv>().post('/turn', async c => {
  const parsed = authoringTurnRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || parsed.data.target === 'workflow') return respondError(c, 400, 'invalid-request')
  const request = parsed.data as AuthoringTurnRequest & { target: 'query' | 'dashboard' }
  const principal = c.get('principal')!
  if (principal.kind !== 'device') return respondError(c, 403, 'interactive_user_required')
  const invocation = { principal, signal: c.req.raw.signal }
  const validate = async (candidate: unknown): Promise<{ candidate?: unknown; problems: string[] }> => {
    try {
      if (request.target === 'query') {
        const content = queryContentSchema.parse(candidate)
        await resolveQuery(c.env, request.scope, { kind: 'inline', content, bindings: {} }, {}, invocation)
        return { candidate: content, problems: [] }
      }
      const content = dashboardPanelContentSchema.parse(candidate)
      // The same check publication runs, so the AI can't propose a panel that publish would refuse.
      const problems = (await dashboardContentProblems(c.env, request.scope, content, invocation)).map(describeDashboardProblem)
      return problems.length ? { problems } : { candidate: content, problems }
    } catch (error) {
      return { problems: [message(error)] }
    }
  }
  // Kept so a give-up can be logged with what the model actually said, which the result drops.
  let lastReply = ''
  try {
    const models = createModelService(getDb(c.env), c.env.SECRETS)
    const result = await runAuthoringTurn({
      request,
      system: authoringSystemPrompt(request.target, TARGET_PROMPTS[request.target]),
      signal: c.req.raw.signal,
      generate: async input => {
        const generated = await models.generateText({
          userId: ownerId(c), backendId: request.backendId,
          input: { ...input, ...(request.modelId ? { modelId: request.modelId } : {}) },
        })
        lastReply = generated.text
        return generated
      },
      validate,
      metadata: metadataRequest => authoringMetadata({ env: c.env, turn: request, request: metadataRequest, invocation, validate }),
    })
    // Both are a 200 to the client, so without this line a failed turn leaves no trace anywhere.
    // The reply can quote sample records; the collector scrubs secrets and cuts it to 512 characters.
    const problems = result.state === 'stopped' ? [result.reason] : result.state === 'proposal' ? result.problems : []
    if (problems.length) {
      log.warn('turn ended without a valid candidate', {
        target: request.target, state: result.state, provider: result.providerId, model: result.modelId,
        problems: problems.join(' | '), reply: lastReply,
      })
    }
    return c.json(result)
  } catch (error) {
    if (error instanceof ProviderOperationError) return respondError(c, error.status, error.code)
    if (c.req.raw.signal.aborted) return respondError(c, 408, 'cancelled')
    return respondError(c, 400, 'authoring_failed', [message(error)])
  }
})
