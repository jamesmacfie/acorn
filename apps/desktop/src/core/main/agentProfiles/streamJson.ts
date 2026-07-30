import type { HeadlessCapture, StreamEvent, StreamJsonAdapter } from './types'

export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as StreamEvent
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
