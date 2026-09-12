import type {
  AgentNormalizedEvent,
  AgentPermissionOption,
  AgentQuestion,
} from '@acorn/protocol/managedAgents.ts'

export type FormElicitationRequest = {
  message: string
  requestedSchema?: unknown
}

export type FormElicitationResponse = {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, string | number | boolean | string[]>
}

type FormProperty = {
  type?: string
  title?: string | null
  description?: string | null
  enum?: string[] | null
  oneOf?: EnumOption[] | null
  items?: { enum?: string[] | null; anyOf?: EnumOption[] | null } | null
}

type EnumOption = { const: string; title?: string | null; description?: string | null }

const questionsFor = (request: FormElicitationRequest): AgentQuestion[] => {
  const schema = request.requestedSchema as { properties?: Record<string, unknown> } | undefined
  return Object.entries(schema?.properties ?? {}).map(([key, value]) => {
    const property = value as FormProperty
    const options = formOptions(property)
    const title = property.title ?? undefined
    const description = property.description ?? undefined
    return {
      id: key,
      // Both only when the property carries both. A form with one question puts that question in
      // `message` and leaves the field with a bare header, so using the header twice reads twice.
      ...(title && description ? { header: title } : {}),
      prompt: description ?? title ?? request.message,
      ...(options ? { options } : {}),
      ...(property.type === 'array' ? { multiple: true } : {}),
    }
  })
}

// The choices a property offers, or nothing when it is a free-text field. `id` is what goes back to
// the agent and `label` is what a person reads, which differ whenever the agent titles its options.
const formOptions = (property: FormProperty): AgentQuestion['options'] => {
  const titled = property.type === 'array' ? property.items?.anyOf : property.oneOf
  if (titled?.length) {
    return titled.map((option) => ({
      id: option.const,
      label: option.title || option.const,
      ...(option.description ? { description: option.description } : {}),
    }))
  }
  const bare = property.type === 'array' ? property.items?.enum : property.enum
  if (bare?.length) return bare.map((value) => ({ id: value, label: value }))
  if (property.type === 'boolean') return [{ id: 'true', label: 'Yes' }, { id: 'false', label: 'No' }]
  return undefined
}

const skipOption: AgentPermissionOption[] = [
  { id: 'decline', label: 'Skip', kind: 'reject_once' },
]

const consentOptions: AgentPermissionOption[] = [
  { id: 'accept', label: 'Allow', kind: 'allow_once' },
  { id: 'decline', label: 'Decline', kind: 'reject_once' },
]

// MCP form elicitation covers two shapes. Properties ask for structured input; an empty schema asks
// only for consent. Both ACP and Codex carry the same schema and expect the same action response.
export function normalizeFormElicitation(
  requestId: string,
  request: FormElicitationRequest,
): AgentNormalizedEvent {
  const questions = questionsFor(request)
  return {
    type: 'request',
    requestId,
    kind: questions.length ? 'question' : 'elicitation',
    title: request.message,
    questions,
    options: questions.length ? skipOption : consentOptions,
  }
}

// What a person picked, on its way back to the agent. The card answers with labels, so each one is
// matched to the option that offered it and the option's own value is what travels.
const formValue = (property: FormProperty, label: string): string =>
  formOptions(property)?.find((option) => option.label === label)?.id ?? label

export function formElicitationResponse(
  request: FormElicitationRequest,
  resolution: unknown,
): FormElicitationResponse {
  if (typeof resolution !== 'object' || resolution == null) return { action: 'cancel' }
  const row = resolution as Record<string, unknown>
  if (typeof row.optionId === 'string') {
    if (row.optionId === 'accept') return { action: 'accept', content: {} }
    return { action: row.optionId === 'cancel' ? 'cancel' : 'decline' }
  }

  const answers = (typeof row.answers === 'object' && row.answers != null ? row.answers : {}) as Record<string, unknown>
  const content: Record<string, string | number | boolean | string[]> = {}
  const schema = request.requestedSchema as { properties?: Record<string, unknown> } | undefined
  for (const [key, value] of Object.entries(schema?.properties ?? {})) {
    const property = value as FormProperty
    const answer = answers[key]
    const picked = (Array.isArray(answer) ? answer.map(String) : [String(answer ?? '')])
      .filter((item) => item !== '')
      .map((label) => formValue(property, label))
    if (!picked.length) continue
    if (property.type === 'array') content[key] = picked
    else if (property.type === 'boolean') content[key] = picked[0] === 'true'
    else if (property.type === 'number' || property.type === 'integer') {
      const parsed = Number(picked[0])
      if (!Number.isNaN(parsed)) content[key] = parsed
    } else content[key] = picked[0]
  }
  // An unanswered property is absent, including one the schema marked `required`. Claude's adapter
  // marks none, and an agent that does gets the same empty value it gets from a partially filled form.
  return { action: 'accept', content }
}
