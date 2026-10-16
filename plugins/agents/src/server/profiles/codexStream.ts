import { lineDelimitedJsonAdapter, type AgentProfileContribution, type StreamEvent } from '@acorn/plugin-api/node'

type StreamJsonAdapter = NonNullable<AgentProfileContribution['streamJson']>
type HeadlessCapture = ReturnType<StreamJsonAdapter['parse']>

// Core's line parser: the framing is the same newline-delimited JSON as claude's.
const parseStreamLine = lineDelimitedJsonAdapter.parseLine

// The stream shape of `codex exec --json`. Codex shares nothing with claude's stream but the newline.
// There is no `result` event at all: the answer is the text of the last `item.completed` whose item is
// an `agent_message`, the resume reference arrives up front on `thread.started`, and the token counts
// arrive at the end on `turn.completed`. Read through core's `lineDelimitedJsonAdapter`, every field of
// the capture comes back null, `runHeadless` calls the run `malformed`, and no codex turn can succeed.
//
// The stream carries no cost, so `costUsd` is null and stays null. Codex reports tokens only, and a
// number we would have to invent from a price table is worse than an honest absence.
function codexItem(event: StreamEvent): Record<string, unknown> | null {
  return event.item && typeof event.item === 'object' ? (event.item as Record<string, unknown>) : null
}

const codexNumber = (usage: Record<string, unknown>, key: string): number | undefined =>
  typeof usage[key] === 'number' ? (usage[key] as number) : undefined

// With `--output-schema`, codex answers with the JSON as the agent message's text: there is no separate
// structured field to read. So we parse the text, and only accept an object or an array. The adapter
// cannot see whether a schema was asked for, and that narrow rule is what keeps the guess safe: a prose
// answer such as "Blue" does not parse at all, and a bare `42` is not what any caller of
// `structuredOutput` reads. Every one of them wants a shape (`{ verdict }` for a workflow decision,
// `{ tasks }` for a delegated-agent plan, an array for a structured report), and a workflow `decide` step on codex
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
  const events = stdout
    .split('\n')
    .map(parseStreamLine)
    .filter((event): event is StreamEvent => event != null)
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
  const usage = turn?.usage && typeof turn.usage === 'object' ? (turn.usage as Record<string, unknown>) : null
  const inputTokens = usage ? codexNumber(usage, 'input_tokens') : undefined
  const outputTokens = usage ? codexNumber(usage, 'output_tokens') : undefined
  const cachedInputTokens = usage ? codexNumber(usage, 'cached_input_tokens') : undefined
  const cacheWriteInputTokens = usage ? codexNumber(usage, 'cache_write_input_tokens') : undefined
  return {
    result,
    structuredOutput: codexStructured(result),
    sessionId: typeof threadId === 'string' ? threadId : null,
    costUsd: null,
    ...(inputTokens !== undefined ||
    outputTokens !== undefined ||
    cachedInputTokens !== undefined ||
    cacheWriteInputTokens !== undefined
      ? {
          usage: {
            ...(inputTokens !== undefined ? { inputTokens } : {}),
            ...(outputTokens !== undefined ? { outputTokens } : {}),
            ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
            ...(cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens } : {}),
          },
        }
      : {}),
    events,
  }
}

// `parseLine` is the shared one on purpose. It hands the Agents panel and a workflow step's event feed
// the raw codex event, which is what they render, and only `parse` needs to know the shape.
export const codexJsonAdapter: StreamJsonAdapter = { parse: parseCodexStreamJson, parseLine: parseStreamLine }
