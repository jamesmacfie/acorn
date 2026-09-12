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

// Both adapters below read the same newline-delimited stdout and differ only in which events they
// care about, so the splitting lives here once and `parseStreamLine` stays the only line parser.
function parseStreamEvents(stdout: string): StreamEvent[] {
  return stdout.split('\n').map(parseStreamLine).filter((event): event is StreamEvent => event != null)
}

export function parseStreamJson(stdout: string): HeadlessCapture {
  const events = parseStreamEvents(stdout)
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

// The second stream shape, for `codex exec --json`. We keep it here beside the first because both are
// stdout parsers over the same newline framing, and a plugin cannot reach a file core does not export.
//
// Codex shares nothing with claude's stream but the newline. There is no `result` event at all: the
// answer is the text of the last `item.completed` whose item is an `agent_message`, the resume
// reference arrives up front on `thread.started`, and the token counts arrive at the end on
// `turn.completed`. Read through `parseStreamJson` above, every field of the capture comes back null,
// `runHeadless` calls the run `malformed`, and no codex turn can ever succeed. That was already true of
// codex headless steps before any one-shot mode existed, so this fixes a standing bug rather than
// paying for a new feature.
//
// The stream carries no cost, so `costUsd` is null and stays null. Codex reports tokens only, and a
// number we would have to invent from a price table is worse than an honest absence.
function codexItem(event: StreamEvent): Record<string, unknown> | null {
  return event.item && typeof event.item === 'object' ? event.item as Record<string, unknown> : null
}

const codexNumber = (usage: Record<string, unknown>, key: string): number | undefined =>
  typeof usage[key] === 'number' ? usage[key] as number : undefined

// With `--output-schema`, codex answers with the JSON as the agent message's text: there is no separate
// structured field to read. So we parse the text, and only accept an object or an array. The adapter
// cannot see whether a schema was asked for, and that narrow rule is what keeps the guess safe: a prose
// answer such as "Blue" does not parse at all, and a bare `42` is not what any caller of
// `structuredOutput` reads. Every one of them wants a shape (`{ verdict }` for a workflow decision,
// `{ tasks }` for a fan-out plan, an array for a memory review), and a workflow `decide` step on codex
// fails on the spot without this, because it refuses an outcome with no verdict object.
function codexStructured(text: string | null): unknown | null {
  if (!text) return null
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  for (const candidate of [fenced?.[1]?.trim(), text.trim()]) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // Not JSON, so this turn answered in prose. Try the next reading, then give up: a caller that
      // asked for a schema and got prose should see an empty structured field, not a coerced string.
    }
  }
  return null
}

export function parseCodexStreamJson(stdout: string): HeadlessCapture {
  const events = parseStreamEvents(stdout)
  // Last message wins. A turn that says something, runs a tool and then says something else has its
  // answer in the second message, and reasoning items arrive as their own `item.type`.
  let result: string | null = null
  for (let i = events.length - 1; i >= 0 && result == null; i--) {
    if (events[i].type !== 'item.completed') continue
    const item = codexItem(events[i])
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

// `parseLine` is the shared one on purpose. It hands the Agents panel and a workflow step's event feed
// the raw codex event, which is what they render, and only `parse` needs to know the shape.
export const codexJsonAdapter: StreamJsonAdapter = { parse: parseCodexStreamJson, parseLine: parseStreamLine }

// The third reading, for a CLI whose one-shot mode prints the answer and nothing else. `opencode run`
// on a pipe is the case it exists for: its header, tool lines and prompts all go to stderr, so stdout
// carries the assistant's text alone. A manifest harness picks it with `output: "text"`.
//
// Empty stdout stays null rather than becoming an empty answer, so a CLI that exited 0 and printed
// nothing reads as `malformed` in `runHeadless` instead of as a successful blank generate.
//
// `structuredOutput` is always null, so a workflow `decide` step naming a text-output harness
// fails on a missing verdict. That is the honest ceiling of the data tier, which has no way to declare a
// schema flag for the CLI to answer JSON. The upgrade path is either the reading codex uses above,
// parsing the answer when it happens to be JSON, or a code-tier profile.
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
