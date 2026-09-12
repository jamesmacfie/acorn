import { z } from 'zod'
import type { AgentEventRecord } from '@acorn/protocol/managedAgents.ts'

/** Reject a malformed or unsupported contract before durable work is accepted. */
export function validResultSchema(schema: object): boolean {
  try {
    z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0])
    return true
  } catch {
    return false
  }
}

export function promptWithResultContract(prompt: string, schema: object | undefined): string {
  if (!schema) return prompt
  return [
    prompt,
    'Complete the task, then end your final response with exactly one fenced `json` block matching this result schema.',
    'Do not put commentary inside that JSON block.',
    JSON.stringify(schema),
  ].join('\n\n')
}

export function assistantResult(events: AgentEventRecord[], maxChars = 256 * 1024): string | null {
  let text = ''
  for (const record of events) {
    if (record.event.type !== 'assistant_message') continue
    text = (record.event.append ? text + record.event.text : record.event.text).slice(-maxChars)
  }
  return text.trim() || null
}

/** Parse and validate a provider result against the caller's JSON Schema. */
export function parseStructuredResult(text: string, schema: object | undefined): unknown | null {
  if (!schema) return null
  const candidates = [
    ...[...text.matchAll(/```json\s*([\s\S]*?)```/gi)].map((match) => match[1]?.trim() ?? ''),
    text.trim(),
  ]
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1))
  const firstBracket = text.indexOf('[')
  const lastBracket = text.lastIndexOf(']')
  if (firstBracket >= 0 && lastBracket > firstBracket) candidates.push(text.slice(firstBracket, lastBracket + 1))
  let validator: z.ZodType
  try {
    validator = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0])
  } catch {
    return null
  }
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const parsed: unknown = JSON.parse(candidate)
      const result = validator.safeParse(parsed)
      if (result.success) return result.data
    } catch {
      // Try the next bounded representation. No candidate is trusted until the schema accepts it.
    }
  }
  return null
}
