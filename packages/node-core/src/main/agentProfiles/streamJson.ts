import type { HeadlessCapture, StreamEvent, StreamJsonAdapter } from './types'
import { z } from 'zod'

const streamEventSchema = z.object({ type: z.string().optional() }).passthrough()

export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = streamEventSchema.safeParse(JSON.parse(trimmed))
    return parsed.success ? parsed.data as StreamEvent : null
  } catch {
    return null
  }
}

export function parseStreamJson(stdout: string): HeadlessCapture {
  const events = stdout.split('\n').map(parseStreamLine).filter((event): event is StreamEvent => event != null)
  const resultEvent = [...events].reverse().find((event) => event.type === 'result')
  const usage = resultEvent?.usage && typeof resultEvent.usage === 'object'
    ? resultEvent.usage as Record<string, unknown>
    : null
  return {
    result: typeof resultEvent?.result === 'string' ? resultEvent.result : null,
    structuredOutput: resultEvent && 'structured_output' in resultEvent ? (resultEvent.structured_output ?? null) : null,
    sessionId: typeof resultEvent?.session_id === 'string' ? resultEvent.session_id : null,
    costUsd:
      typeof resultEvent?.total_cost_usd === 'number'
        ? resultEvent.total_cost_usd
        : typeof resultEvent?.cost_usd === 'number'
          ? resultEvent.cost_usd
          : null,
    ...(usage
      ? {
          usage: {
            ...(typeof usage.input_tokens === 'number' ? { inputTokens: usage.input_tokens } : {}),
            ...(typeof usage.output_tokens === 'number' ? { outputTokens: usage.output_tokens } : {}),
            ...(typeof usage.cache_read_input_tokens === 'number'
              ? { cachedInputTokens: usage.cache_read_input_tokens }
              : {}),
          },
        }
      : {}),
    events,
  }
}

export const lineDelimitedJsonAdapter: StreamJsonAdapter = { parse: parseStreamJson, parseLine: parseStreamLine }

const codexItem = (event: StreamEvent): Record<string, unknown> | null =>
  event.item && typeof event.item === 'object' ? event.item as Record<string, unknown> : null

const codexNumber = (usage: Record<string, unknown>, key: string): number | undefined =>
  typeof usage[key] === 'number' ? usage[key] as number : undefined

const codexStructured = (text: string | null): unknown | null => {
  if (!text) return null
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  for (const candidate of [fenced?.[1]?.trim(), text.trim()]) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // Prose is a valid text result, but not a structured result.
    }
  }
  return null
}

/** Read the event shape emitted by `codex exec --json`. */
export function parseCodexStreamJson(stdout: string): HeadlessCapture {
  const events = stdout.split('\n').map(parseStreamLine).filter((event): event is StreamEvent => event != null)
  let result: string | null = null
  for (let index = events.length - 1; index >= 0 && result == null; index--) {
    if (events[index]?.type !== 'item.completed') continue
    const item = codexItem(events[index]!)
    if (item?.type === 'agent_message' && typeof item.text === 'string') result = item.text
  }
  const threadId = events.find((event) => event.type === 'thread.started')?.thread_id
  const turn = [...events].reverse().find((event) => event.type === 'turn.completed')
  const usage = turn?.usage && typeof turn.usage === 'object' ? turn.usage as Record<string, unknown> : null
  const inputTokens = usage ? codexNumber(usage, 'input_tokens') : undefined
  const outputTokens = usage ? codexNumber(usage, 'output_tokens') : undefined
  const cachedInputTokens = usage ? codexNumber(usage, 'cached_input_tokens') : undefined
  return {
    result,
    structuredOutput: codexStructured(result),
    sessionId: typeof threadId === 'string' ? threadId : null,
    costUsd: null,
    ...(inputTokens !== undefined || outputTokens !== undefined || cachedInputTokens !== undefined
      ? {
          usage: {
            ...(inputTokens !== undefined ? { inputTokens } : {}),
            ...(outputTokens !== undefined ? { outputTokens } : {}),
            ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
          },
        }
      : {}),
    events,
  }
}

export const codexJsonAdapter: StreamJsonAdapter = { parse: parseCodexStreamJson, parseLine: parseStreamLine }
