import {
  AUTHORING_LIMITS,
  authoringSystemPrompt,
  boundedAuthoringSample,
  runAuthoringTurn,
  type AuthoringMetadataRequest,
  type AuthoringTurnRequest,
  type AuthoringTurnResult,
} from '@acorn/protocol/authoring.ts'
import type { DataSourceCatalog, DataSourceDiscoveryPage, DataSourceDiscoveryRequest, DataSourceQuery, DataSourceRequest, DataSourceResponse } from '@acorn/protocol/dataSources.ts'
import type { Principal } from '@acorn/plugin-api/node'
import type { WorkflowCatalog, WorkflowDef } from '../../shared/workflowContracts'
import { parseGeneratedWorkflow } from './ground'
import { renderStepKinds, renderVocabulary } from './generate'
import { renderWorkflowTargets } from './targetPrompt'
import { validateWorkflow, type WorkflowValidationCatalog } from '../validation/definition'

export type SourceRuntime = {
  list(scope: DataSourceQuery['scope'], invocation: { principal: Principal; signal: AbortSignal }): Promise<DataSourceCatalog>
  discoverAvailable(request: DataSourceDiscoveryRequest, invocation: { principal: Principal; signal: AbortSignal }): Promise<DataSourceDiscoveryPage>
  invoke<R extends DataSourceRequest>(request: R, invocation: { principal: Principal; signal: AbortSignal }): Promise<DataSourceResponse<R>>
}

const sameScope = (turn: AuthoringTurnRequest, scope: DataSourceQuery['scope']) =>
  scope.workspaceId === turn.scope.workspaceId && scope.projectId === turn.scope.projectId

function systemPrompt(catalog: WorkflowCatalog): string {
  const instructions = [
    'The candidate must be one WorkflowDef with baseline acorn-1, formatVersion 1, and stable step ids.',
    'Use metadata to discover sources, fields, dynamic option ids, and compatible child workflows.',
    'Changing a child target is allowed only when the proposal summary calls it out for review.',
    renderStepKinds(catalog, 18_000),
    renderVocabulary(catalog, 8_000),
    renderWorkflowTargets(catalog),
  ].join('\n\n')
  return authoringSystemPrompt('workflow', instructions)
}

export async function authorWorkflowConversation(args: {
  request: AuthoringTurnRequest
  catalog: WorkflowCatalog
  validation: WorkflowValidationCatalog
  principal: Principal
  signal: AbortSignal
  sources: SourceRuntime
  generate(input: { system: string; prompt: string; maxOutputTokens: number; signal?: AbortSignal }): Promise<{
    text: string; providerId: string; modelId: string; usage?: { inputTokens?: number; outputTokens?: number }
  }>
}): Promise<AuthoringTurnResult> {
  const validate = async (candidate: unknown): Promise<{ candidate?: WorkflowDef; problems: string[] }> => {
    const parsed = parseGeneratedWorkflow(JSON.stringify(candidate))
    if ('error' in parsed) return { problems: [parsed.error] }
    const problems = validateWorkflow(parsed.def, args.validation)
    return { candidate: parsed.def, problems }
  }
  const invocation = { principal: args.principal, signal: args.signal }
  const metadata = async (request: AuthoringMetadataRequest): Promise<unknown> => {
    if (request.operation === 'validate-candidate') return validate(request.candidate)
    if (request.operation === 'list-workflows') return { workflows: (args.catalog.workflows ?? []).slice(0, 100) }
    if (request.operation === 'list-sources') return args.sources.list({ ...args.request.scope, parameters: {} }, invocation)
    if (request.operation === 'list-accounts') return { unavailable: true, reason: 'Workflow authoring has no account catalogue.' }
    if (request.operation === 'discover-sources') {
      if (!sameScope(args.request, request.scope)) throw new Error('The metadata request is outside the selected workspace or project.')
      return args.sources.discoverAvailable(request, invocation)
    }
    if (request.operation === 'preview-sample') {
      if (!args.request.samplesEnabled) return { unavailable: true, reason: 'Preview samples are disabled for this conversation.' }
      if (!sameScope(args.request, request.query.scope)) throw new Error('The sample request is outside the selected workspace or project.')
      const result = await args.sources.invoke({ operation: 'query', query: request.query, mode: 'preview', evaluationTime: Date.now(), pageSize: AUTHORING_LIMITS.sampleRecords }, invocation)
      return boundedAuthoringSample(request.query, request.fields, result.records)
    }
    if (!sameScope(args.request, request.scope)) throw new Error('The metadata request is outside the selected workspace or project.')
    if (request.operation === 'describe-source') return args.sources.invoke({ operation: 'describe', source: request.source, scope: request.scope }, invocation)
    return args.sources.invoke(request, invocation)
  }
  return runAuthoringTurn({ request: args.request, system: systemPrompt(args.catalog), generate: args.generate, metadata, validate, signal: args.signal })
}
