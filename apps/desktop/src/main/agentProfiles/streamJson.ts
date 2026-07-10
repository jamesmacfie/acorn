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
    events,
  }
}

export const lineDelimitedJsonAdapter: StreamJsonAdapter = { parse: parseStreamJson, parseLine: parseStreamLine }

