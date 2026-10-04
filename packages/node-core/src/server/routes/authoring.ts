import { Hono } from 'hono'
import {
  authoringSystemPrompt,
  authoringTurnRequestSchema,
  runAuthoringTurn,
  type AuthoringTurnRequest,
} from '@acorn/protocol/authoring.ts'
import { panelPlanSchema, type PanelPlan } from '@acorn/protocol/dashboards.ts'
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
import { PANEL_CAPABILITIES } from '@acorn/dashboards-core/capabilities.ts'
import { listConnections } from '../integrations/connections'
import { invokeDataSource, listDataSources } from '../dataSources/runtime'
import { eq } from 'drizzle-orm'
import { schema } from '../db'

const log = createLogger('authoring')

const TARGET_PROMPTS = {
  query: 'The candidate must be one QueryContent object. Keep typed predicates and exact source option ids. Ask for metadata before naming a source, field, operator, connection, or option.',
  dashboard: `The candidate must be one PanelPlan version 2 object. Start with list-sources and list-accounts metadata. Primary sources supply rows; lookup and children sources need declared exact-key relations. Only equivalence merges mirrored records. Use the supported operations and bounds. Account names are choices, never guesses. The person's request and requirements checklist belong in the plan; partial and unavailable items need reasons. Capabilities: ${JSON.stringify(PANEL_CAPABILITIES)}.`,
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
  const accounts = request.target === 'dashboard' ? (await listConnections(getDb(c.env), principal.userId))
    .filter(account => !['disabled', 'needs-auth'].includes(account.status)) : []
  const sourceCatalog = request.target === 'dashboard' ? await listDataSources(c.env, { ...request.scope, parameters: {} }, invocation) : undefined
  const basePlan = request.target === 'dashboard' ? panelPlanSchema.safeParse(request.base) : undefined
  const descriptions = basePlan?.success ? await Promise.all(basePlan.data.sources.map(async source => {
    if (source.reference.kind !== 'inline') return { id: source.id, unavailable: 'Resolve the saved query first.' }
    const query = source.reference.content.query
    try { return { id: source.id, description: await invokeDataSource(c.env, { operation: 'describe', source: query.source, scope: query.scope }, invocation) } }
    catch { return { id: source.id, unavailable: 'Choose an account or reachable scope.' } }
  })) : []
  const projects = request.target === 'dashboard' ? await getDb(c.env).select({ id: schema.projects.id, name: schema.projects.name, githubOwner: schema.projects.githubOwner, githubName: schema.projects.githubName }).from(schema.projects).where(eq(schema.projects.workspaceId, request.scope.workspaceId)) : []
  const links = request.target === 'dashboard' ? await getDb(c.env).select({ projectId: schema.workspaceExternalProjects.projectId, integrationId: schema.workspaceExternalProjects.integrationId, externalId: schema.workspaceExternalProjects.externalId }).from(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.workspaceId, request.scope.workspaceId)) : []
  const validate = async (candidate: unknown): Promise<{ candidate?: unknown; problems: string[] }> => {
    try {
      if (request.target === 'query') {
        const content = queryContentSchema.parse(candidate)
        await resolveQuery(c.env, request.scope, { kind: 'inline', content, bindings: {} }, {}, invocation)
        return { candidate: content, problems: [] }
      }
      const content = panelPlanSchema.parse(candidate)
      const problems = (await dashboardContentProblems(c.env, request.scope, content, invocation)).map(describeDashboardProblem)
      const base = panelPlanSchema.safeParse(request.base)
      const originalRequest = base.success && base.data.request ? base.data.request : request.instruction
      if (content.request !== originalRequest) problems.push('/request: Preserve the person\'s original request exactly.')
      const chosen = new Set(base.success ? base.data.sources.flatMap(source => source.reference.kind === 'inline' && source.reference.content.query.scope.connectionId ? [source.reference.content.query.scope.connectionId] : []) : [])
      for (const [index, source] of content.sources.entries()) {
        const inline = source.reference.kind === 'inline' ? source.reference.content.query : undefined
        if (!inline) continue
        const provider = sourceCatalog?.sources.find(entry => entry.pluginId === inline.source.pluginId && entry.sourceId === inline.source.sourceId)?.providerId
        const eligible = accounts.filter(account => account.provider === provider)
        if (provider && (!inline.scope.connectionId || (!chosen.has(inline.scope.connectionId) && !(eligible.length === 1 && eligible[0]?.id === inline.scope.connectionId)))) {
          problems.push(`/sources/${index}/reference: Choose one of the person's real ${provider} accounts before using it.`)
        }
      }
      problems.push(...checkRequirements(content, base.success ? base.data : undefined, request.instruction))
      // The same check publication runs, so the AI can't propose a panel that publish would refuse.
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
      ...(request.target === 'dashboard' ? { facts: {
        evaluationTime: Date.now(), time: basePlan?.success ? basePlan.data.time : undefined,
        sources: sourceCatalog?.sources, accounts: accounts.map(account => ({ id: account.id, providerId: account.provider, name: account.name ?? account.label })),
        descriptions, projects, links, capabilities: PANEL_CAPABILITIES,
      } } : {}),
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
    if (request.target === 'dashboard' && result.state === 'proposal' && !result.problems.length) {
      const candidate = panelPlanSchema.safeParse(result.candidate)
      if (candidate.success) {
        try {
          const independent = await models.generateText({
            userId: ownerId(c), backendId: request.backendId,
            input: { system: 'List only the distinct requirements in the user request. You cannot see any proposed plan. Reply as a JSON array of short strings.',
              prompt: JSON.stringify({ request: basePlan?.success && basePlan.data.request ? basePlan.data.request : request.instruction }), maxOutputTokens: 1500, signal: c.req.raw.signal,
              ...(request.modelId ? { modelId: request.modelId } : {}) },
          })
          const items = JSON.parse(independent.text) as unknown
          if (Array.isArray(items)) {
            const authored = (candidate.data.requirements ?? []).map(item => item.text.toLowerCase())
            result.unaddressed = items.filter((item): item is string => typeof item === 'string' && item.length <= 200)
              .filter(item => !authored.some(text => text.includes(item.toLowerCase()) || item.toLowerCase().includes(text)))
            log.info('independent dashboard requirements pass', { missing: result.unaddressed.length, total: items.length })
          }
        } catch { /* An independent review can fail without changing a validated proposal. */ }
      }
    }
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

function checkRequirements(content: PanelPlan, previous: PanelPlan | undefined, instruction: string): string[] {
  const problems: string[] = []
  if (!content.request) problems.push('/request: Keep the person\'s original request in the plan.')
  if (!content.requirements?.length) problems.push('/requirements: List each requested outcome, including unavailable parts.')
  for (const [index, item] of (content.requirements ?? []).entries()) {
    if (['covered', 'partial'].includes(item.status) && !item.paths?.length) problems.push(`/requirements/${index}: ${item.text} needs a plan pointer.`)
    for (const path of item.paths ?? []) {
      const [section, key] = path.slice(1).split('/')
      const exists = section === 'columns' ? content.columns.some(column => column.id === key)
        : section === 'sources' ? content.sources.some(source => source.id === key)
          : section === 'stages' ? !!content.stages[Number(key)]
            : section === 'view' ? key === undefined || key in content.view
              : section === 'sort' ? !!content.sort?.[Number(key)]
                : section === 'group' ? !!content.group?.[Number(key)] : false
      if (!exists) problems.push(`/requirements/${index}/paths: ${path} does not name a plan part.`)
    }
  }
  for (const item of previous?.requirements ?? []) {
    const expresslyRemoved = /\b(remove|forget|drop)\b/i.test(instruction)
      && (instruction.toLowerCase().includes(item.text.toLowerCase()) || instruction.toLowerCase().includes(item.id.toLowerCase()))
    if (item.status === 'covered' && !expresslyRemoved && !content.requirements?.some(next => next.id === item.id)) problems.push(`/requirements: Previously covered item ${item.text} disappeared.`)
  }
  return problems
}
