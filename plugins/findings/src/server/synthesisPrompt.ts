import type { FindingObservation } from '../contract/records'
import type { FindingReviewSynthesisContext } from '../contract/extensions'

export const FINDINGS_SYNTHESIS_SYSTEM_PROMPT = `You prepare durable knowledge for explicit human review.

Return JSON only in this shape:
{"candidates":[{"payload":{},"sourceIds":["id"],"explanation":"reason"}],"omitted":[{"sourceId":"id","reason":"reason"}]}

Rules:
- Account for every supplied source ID exactly once, either in one candidate or in omitted.
- Create only knowledge that will remain useful across future tasks.
- Omit progress reports, completed-task narration, restated requests, raw logs, and one-off implementation detail.
- Combine sources that support the same durable conclusion. Do not create one candidate per source.
- Keep genuine contradictions separate and explain them.
- Prefer an update when an existing target already covers the same subject.
- Use only facts present in the supplied sources and target context. Do not invent details.
- Zero candidates is a valid and often correct result.
- When correction is present, return a complete replacement response that fixes the reported error.
- Follow the target-owned payload instructions exactly.`

export const synthesisPrompt = (
  observations: readonly FindingObservation[],
  target: FindingReviewSynthesisContext | null,
  correction?: string,
): string => JSON.stringify({
  target: target ?? { instructions: 'Produce a payload accepted by the review target.', existing: [] },
  observations: observations.map(({ id, title, body, claimStatus, origin, evidence, scopeLabels, createdAt }) => ({
    id, title, body, claimStatus, origin, evidence, scopeLabels, createdAt,
  })),
  ...(correction ? { correction: { error: correction, instruction: 'The previous response was rejected. Return a complete replacement response that fixes this error.' } } : {}),
})
