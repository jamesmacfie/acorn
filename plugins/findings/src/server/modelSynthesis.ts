import type { CoreServices } from '@acorn/plugin-api/node'
import type { FindingReviewSynthesisContext, FindingReviewTargetContribution } from '../contract/extensions'
import type { FindingObservation, FindingScope } from '../contract/records'
import { FINDING_CANDIDATE_PAYLOAD_BYTES } from '../contract/review'
import { FindingCaptureError } from './capture'
import type { FindingSynthesisResult } from './reviewStore'
import { FINDINGS_SYNTHESIS_SYSTEM_PROMPT, synthesisPrompt } from './synthesisPrompt'

const MAX_SYNTHESIS_ATTEMPTS = 2

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

const parseSynthesis = (text: string, observations: readonly FindingObservation[]): FindingSynthesisResult => {
  if (new TextEncoder().encode(text).byteLength > FINDING_CANDIDATE_PAYLOAD_BYTES) {
    throw new FindingCaptureError('invalid-input', 'synthesis result exceeds the candidate payload limit')
  }
  const parsed = JSON.parse(text) as { candidates?: unknown; omitted?: unknown }
  if (!Array.isArray(parsed.candidates)) throw new FindingCaptureError('invalid-input', 'synthesis result has no candidates array')
  const groups = parsed.candidates.map((item) => {
    if (!item || typeof item !== 'object') throw new FindingCaptureError('invalid-input', 'synthesis candidate is invalid')
    const row = item as Record<string, unknown>
    if (!Array.isArray(row.sourceIds) || row.sourceIds.some((id) => typeof id !== 'string') || typeof row.explanation !== 'string') {
      throw new FindingCaptureError('invalid-input', 'synthesis candidate source IDs are invalid')
    }
    return { payload: row.payload, sourceIds: row.sourceIds as string[], explanation: row.explanation }
  })
  const omissions: FindingSynthesisResult['omissions'] = []
  const accounted = new Map<string, number>()
  for (const sourceId of groups.flatMap((group) => group.sourceIds)) accounted.set(sourceId, (accounted.get(sourceId) ?? 0) + 1)
  if (Array.isArray(parsed.omitted)) for (const omitted of parsed.omitted) {
    if (!omitted || typeof omitted !== 'object' || typeof (omitted as Record<string, unknown>).sourceId !== 'string' || typeof (omitted as Record<string, unknown>).reason !== 'string') {
      throw new FindingCaptureError('invalid-input', 'synthesis omission is invalid')
    }
    const row = omitted as { sourceId: string; reason: string }
    accounted.set(row.sourceId, (accounted.get(row.sourceId) ?? 0) + 1)
    omissions.push(row)
  }
  if (accounted.size !== observations.length || observations.some((observation) => accounted.get(observation.id) !== 1)) {
    throw new FindingCaptureError('invalid-input', 'synthesis must account for every source ID exactly once as included or omitted')
  }
  return { groups, omissions }
}

const validatePayloads = async (
  synthesis: FindingSynthesisResult,
  scope: FindingScope,
  target: FindingReviewTargetContribution,
): Promise<void> => {
  for (const group of synthesis.groups) await target.validate({ scope, payload: group.payload })
}

export const synthesizeFindingsWithModel = async (args: {
  observations: FindingObservation[]
  scope: FindingScope
  target: FindingReviewTargetContribution
  targetContext: FindingReviewSynthesisContext | null
  generateText: CoreServices['models']['generateText']
  userId: string
  backendId: string
  modelId?: string
}): Promise<FindingSynthesisResult> => {
  const chunks: FindingObservation[][] = []
  for (const observation of args.observations) {
    const current = chunks.at(-1), size = new TextEncoder().encode(JSON.stringify(observation)).byteLength
    const currentSize = current ? new TextEncoder().encode(JSON.stringify(current)).byteLength : 0
    if (!current || current.length >= 50 || currentSize + size > 32 * 1024) chunks.push([observation])
    else current.push(observation)
  }
  const allGroups: FindingSynthesisResult['groups'] = []
  const allOmissions: FindingSynthesisResult['omissions'] = []
  let inputTokens = 0, outputTokens = 0, hasUsage = false
  for (const chunk of chunks) {
    let correction: string | undefined
    for (let attempt = 0; attempt < MAX_SYNTHESIS_ATTEMPTS; attempt += 1) {
      const result = await args.generateText({ userId: args.userId, backendId: args.backendId, timeoutMs: 60_000, input: {
        system: FINDINGS_SYNTHESIS_SYSTEM_PROMPT,
        prompt: synthesisPrompt(chunk, args.targetContext, correction),
        ...(args.modelId ? { modelId: args.modelId } : {}),
        maxOutputTokens: 8_000,
      } })
      if (result.usage) {
        hasUsage = true
        inputTokens += result.usage.inputTokens ?? 0
        outputTokens += result.usage.outputTokens ?? 0
      }
      const text = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      try {
        const synthesis = parseSynthesis(text, chunk)
        await validatePayloads(synthesis, args.scope, args.target)
        allGroups.push(...synthesis.groups)
        allOmissions.push(...synthesis.omissions)
        break
      } catch (error) {
        if (attempt + 1 === MAX_SYNTHESIS_ATTEMPTS) throw error
        correction = errorMessage(error)
      }
    }
  }
  return { groups: allGroups, omissions: allOmissions, ...(hasUsage ? { usage: { inputTokens, outputTokens } } : {}) }
}
