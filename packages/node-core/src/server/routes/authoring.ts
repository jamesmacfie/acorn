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
import { validateDashboardContent } from '../dashboards/publication'
import { getDb } from '../db'
import type { AppEnv } from '../middleware/auth'
import { ownerId } from '../middleware/requireUser'
import { ProviderOperationError } from '../integrations/types'
import { resolveQuery } from '../queries/runtime'
import { respondError } from '../respond'

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
      await validateDashboardContent(c.env, request.scope, content, invocation)
      return { candidate: content, problems: [] }
    } catch (error) {
      return { problems: [message(error)] }
    }
  }
  try {
    const models = createModelService(getDb(c.env), c.env.SECRETS)
    return c.json(await runAuthoringTurn({
      request,
      system: authoringSystemPrompt(request.target, TARGET_PROMPTS[request.target]),
      signal: c.req.raw.signal,
      generate: input => models.generateText({
        userId: ownerId(c), backendId: request.backendId,
        input: { ...input, ...(request.modelId ? { modelId: request.modelId } : {}) },
      }),
      validate,
      metadata: metadataRequest => authoringMetadata({ env: c.env, turn: request, request: metadataRequest, invocation, validate }),
    }))
  } catch (error) {
    if (error instanceof ProviderOperationError) return respondError(c, error.status, error.code)
    if (c.req.raw.signal.aborted) return respondError(c, 408, 'cancelled')
    return respondError(c, 400, 'authoring_failed', [message(error)])
  }
})
