import type { AgentNormalizedEvent, AgentRequest } from '@acorn/protocol/managedAgents.ts'

// What the agent asked and what it was told, for the card that keeps the exchange in the thread
// (./AgentEventCard.tsx). Two sources on purpose: the event is what was asked, and it never changes,
// while the request row carries what happened to it and keeps changing until somebody answers.

export type AgentAskedQuestion = {
  prompt: string
  /** What the person said. Empty means they have not said it, or never will. */
  chosen: string[]
  /** The options they passed over, which is the part the transcript alone can still show. */
  alternatives: Array<{ label: string; description?: string }>
}

type AgentRequestEvent = Extract<AgentNormalizedEvent, { type: 'request' }>

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value != null ? value as Record<string, unknown> : {}

// One answer, one or many, as the card wrote it: labels, because that is what both harnesses record as
// what the person said (./AgentRequestCard.tsx).
const picked = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  return typeof value === 'string' && value ? [value] : []
}

/** Nobody answered, and nobody will: the turn was cancelled, or the agent stopped waiting. */
export const askWasAbandoned = (request: AgentRequest | undefined): boolean =>
  request?.status === 'expired' || asRecord(request?.resolution).cancelled === true

export function askedQuestions(
  event: AgentRequestEvent,
  request: AgentRequest | undefined,
): AgentAskedQuestion[] {
  const resolution = asRecord(request?.resolution)
  // A button rather than a form: the Skip beside a question, or the allow and reject on a permission.
  const optionId = typeof resolution.optionId === 'string' ? resolution.optionId : null
  const answers = asRecord(resolution.answers)

  if (!event.questions?.length) {
    const options = event.options ?? []
    const chosen = options.filter((option) => option.id === optionId)
    return [{
      prompt: event.title,
      chosen: chosen.map((option) => option.label),
      alternatives: options
        .filter((option) => option.id !== optionId)
        .map((option) => ({ label: option.label })),
    }]
  }

  return event.questions.map((question) => {
    // An answer the agent asked to keep to itself stays out of the transcript, which is durable and
    // searchable in a way the one-off card above the stream was not.
    const chosen = question.secret ? ['Answer hidden'] : picked(answers[question.id])
    return {
      prompt: question.header ? `${question.header}: ${question.prompt}` : question.prompt,
      chosen,
      alternatives: (question.options ?? [])
        .filter((option) => !chosen.includes(option.label))
        .map((option) => ({ label: option.label, ...(option.description ? { description: option.description } : {}) })),
    }
  })
}
