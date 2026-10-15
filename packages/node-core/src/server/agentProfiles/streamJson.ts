import type { HeadlessCapture, StreamEvent, StreamJsonAdapter } from './types'
import { z } from 'zod'

const streamEventSchema = z.object({ type: z.string().optional() }).passthrough()

export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = streamEventSchema.safeParse(JSON.parse(trimmed))
    return parsed.success ? (parsed.data as StreamEvent) : null
  } catch {
    return null
  }
}

function parseStreamEvents(stdout: string): StreamEvent[] {
  return stdout
    .split('\n')
    .map(parseStreamLine)
    .filter((event): event is StreamEvent => event != null)
}

export function parseStreamJson(stdout: string): HeadlessCapture {
  const events = parseStreamEvents(stdout)
  const resultEvent = [...events].reverse().find((event) => event.type === 'result')
  const usage =
    resultEvent?.usage && typeof resultEvent.usage === 'object' ? (resultEvent.usage as Record<string, unknown>) : null
  return {
    result: typeof resultEvent?.result === 'string' ? resultEvent.result : null,
    structuredOutput:
      resultEvent && 'structured_output' in resultEvent ? (resultEvent.structured_output ?? null) : null,
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

// The second reading, for a CLI whose one-shot mode prints the answer and nothing else. `opencode run`
// on a pipe is the case it exists for: its header, tool lines and prompts all go to stderr, so stdout
// carries the assistant's text alone. A manifest harness picks it with `output: "text"`.
//
// Empty stdout stays null rather than becoming an empty answer, so a CLI that exited 0 and printed
// nothing reads as `malformed` in `runHeadless` instead of as a successful blank generate.
//
// `structuredOutput` is always null, so a workflow `decide` step naming a text-output harness
// fails on a missing verdict. That is the honest ceiling of the data tier, which has no way to declare a
// schema flag for the CLI to answer JSON. The upgrade path is either the reading the agents plugin's codex profile
// uses, parsing the answer when it happens to be JSON, or a code-tier profile.
export const textAdapter: StreamJsonAdapter = {
  parse: (stdout) => ({
    result: stdout.trim() || null,
    structuredOutput: null,
    sessionId: null,
    costUsd: null,
    events: [],
  }),
  // There are no events in a plain-text stream, and a line of prose is not one. The Agents panel and a
  // workflow step's event feed get nothing, which is what they should show.
  parseLine: () => null,
}
