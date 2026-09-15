import { Buffer } from 'node:buffer'
import type {
  AgentCommandDescriptor,
  AgentConfigOption,
  AgentNormalizedEvent,
  AgentQuestion,
  AgentSkillDescriptor,
  AgentWebActivity,
  AgentWebResult,
} from '@acorn/protocol/managedAgents.ts'
import { safeProviderMessage } from '../drivers/diagnostics'

const sliceText = (value: string | undefined, max = 16_384): string | undefined =>
  value == null ? undefined : value.slice(0, max)

const boundedConfig = (option: AgentConfigOption): AgentConfigOption => ({
  ...option,
  id: option.id.slice(0, 200),
  label: option.label.slice(0, 500),
  currentValue: sliceText(option.currentValue ?? undefined, 2_000) ?? null,
  values: option.values.slice(0, 100).map((value) => ({
    value: value.value.slice(0, 2_000),
    label: value.label.slice(0, 500),
    description: sliceText(value.description, 4_000),
  })),
})

const boundedCommands = (commands: AgentCommandDescriptor[] | undefined): AgentCommandDescriptor[] | undefined =>
  commands?.slice(0, 200).map((command) => ({
    name: command.name.slice(0, 200),
    description: sliceText(command.description, 4_000),
    inputHint: sliceText(command.inputHint, 1_000),
  }))

const boundedSkills = (skills: AgentSkillDescriptor[] | undefined): AgentSkillDescriptor[] | undefined =>
  skills?.slice(0, 200).map((skill) => ({
    name: skill.name.slice(0, 200),
    description: sliceText(skill.description, 4_000),
    path: sliceText(skill.path, 4_096),
  }))

const boundedCount = (value: number | undefined): number | undefined =>
  value == null || !Number.isFinite(value) ? undefined : Math.max(0, Math.round(value))

const boundedQuestion = (question: AgentQuestion): AgentQuestion => ({
  ...question,
  id: question.id.slice(0, 2_000),
  header: sliceText(question.header, 500),
  prompt: question.prompt.slice(0, 16_384),
  options: question.options?.slice(0, 100).map((option) => ({
    id: option.id.slice(0, 2_000),
    label: option.label.slice(0, 500),
    description: sliceText(option.description, 4_000),
  })),
})


// ── Web activity ──────────────────────────────────────────────────────────────────────────────
// A search result set is the largest thing a provider hands this ledger that nobody asked it for: a
// model chooses the query, a search engine chooses how many sources come back, and both the titles
// and the snippets are somebody else's HTML. So it is bounded twice — each field on its own, and
// then the whole payload against one ceiling — before it can reach SQLite, the full-text index or a
// client.

/** Per-field ceilings, chosen so that the action — the part that says what the call was — always
 *  fits inside the payload budget below on its own. A search at its limit is about 20 KB and a page
 *  action about 16 KB, which leaves the budget's remaining forty-odd for sources.
 *
 *  Generous against the live captures, where a Codex result set is five rows with two-line snippets
 *  and a Claude one is ten titles and URLs. The action's URL gets more room than a result's because
 *  there is only ever one of it, and 2,048 is the length every browser has treated as a URL's
 *  practical ceiling for twenty years. */
const WEB_LIMITS = {
  queries: 10,
  query: 1_000,
  results: 50,
  title: 500,
  resultUrl: 2_048,
  actionUrl: 8_192,
  domain: 253,
  snippet: 2_000,
  domains: 20,
  prompt: 8_192,
} as const

/** The whole payload, serialized: the same 64 KiB the inline tool input and output budget uses.
 *
 *  Overflow drops trailing sources, and only that. The action is bounded to fit on its own, so this
 *  loop can always finish, and it never has to touch the one field that explains the call.
 *
 *  The plan this work followed put the aggregate in the materializer and promoted the overflow into
 *  an artifact. It is here and lossy instead: an artifact earns its keep for command output and
 *  patches, which a reader wants in full, and the fortieth search result is not that. Keeping the
 *  field limits and the total in one function is also one place to read and one place to test. */
const MAX_WEB_BYTES = 64 * 1024

const boundedStrings = (values: string[] | undefined, count: number, length: number): string[] | undefined =>
  values?.slice(0, count).map((value) => value.slice(0, length))

const boundedWebResult = (result: AgentWebResult): AgentWebResult => ({
  url: result.url.slice(0, WEB_LIMITS.resultUrl),
  title: sliceText(result.title, WEB_LIMITS.title),
  domain: sliceText(result.domain, WEB_LIMITS.domain),
  snippet: sliceText(result.snippet, WEB_LIMITS.snippet),
})

const boundedWebAction = (action: AgentWebActivity['action']): AgentWebActivity['action'] => {
  if (!action) return undefined
  switch (action.type) {
    case 'search':
      return {
        type: 'search',
        queries: boundedStrings(action.queries, WEB_LIMITS.queries, WEB_LIMITS.query) ?? [],
        allowedDomains: boundedStrings(action.allowedDomains, WEB_LIMITS.domains, WEB_LIMITS.domain),
        blockedDomains: boundedStrings(action.blockedDomains, WEB_LIMITS.domains, WEB_LIMITS.domain),
      }
    case 'open_page':
      return { type: 'open_page', url: sliceText(action.url, WEB_LIMITS.actionUrl) }
    case 'find_in_page':
      return {
        type: 'find_in_page',
        url: sliceText(action.url, WEB_LIMITS.actionUrl),
        pattern: sliceText(action.pattern, WEB_LIMITS.prompt),
      }
    case 'fetch_page':
      return {
        type: 'fetch_page',
        url: sliceText(action.url, WEB_LIMITS.actionUrl),
        prompt: sliceText(action.prompt, WEB_LIMITS.prompt),
      }
    case 'other':
      return { type: 'other' }
  }
}

const boundedWeb = (web: AgentWebActivity | undefined): AgentWebActivity | undefined => {
  if (!web) return undefined
  let bounded: AgentWebActivity = {
    action: boundedWebAction(web.action),
    results: web.results?.slice(0, WEB_LIMITS.results).map(boundedWebResult),
  }
  // Trailing sources first and last: a reader who has forty of them is not reading the fiftieth, and
  // dropping one costs less than shortening every snippet above it.
  while (bounded.results?.length && Buffer.byteLength(JSON.stringify(bounded), 'utf8') > MAX_WEB_BYTES) {
    bounded = { ...bounded, results: bounded.results.slice(0, -1) }
  }
  return bounded
}

// Provider processes are trusted to execute only within their declared profile, but their protocol
// text is still untrusted storage/rendering input. Keep normalized events bounded before they reach
// SQLite or the client; large tool output and patches are moved to artifacts by the runtime.
export function boundProviderEvent(
  event: AgentNormalizedEvent,
  secretValues: Iterable<string>,
): AgentNormalizedEvent {
  switch (event.type) {
    case 'assistant_message':
    case 'reasoning':
      return { ...event, subagentId: sliceText(event.subagentId, 2_000) }
    case 'user_message':
      return { ...event, text: event.text.slice(0, 64 * 1024) }
    case 'session_state':
      return { ...event, detail: sliceText(event.detail, 4_000) }
    case 'session_metadata':
      return {
        ...event,
        providerSessionRef: sliceText(event.providerSessionRef, 2_000),
        configOptions: event.configOptions?.slice(0, 100).map(boundedConfig),
        commands: boundedCommands(event.commands),
        skills: boundedSkills(event.skills),
      }
    case 'tool':
      return {
        ...event,
        tool: {
          ...event.tool,
          id: event.tool.id.slice(0, 2_000),
          parentId: sliceText(event.tool.parentId, 2_000),
          title: event.tool.title.slice(0, 500),
          kind: sliceText(event.tool.kind, 200),
          paths: event.tool.paths?.slice(0, 200).map((path) => path.slice(0, 4_096)),
          subagentId: sliceText(event.tool.subagentId, 2_000),
          web: boundedWeb(event.tool.web),
        },
      }
    case 'plan':
      return {
        ...event,
        entries: event.entries.slice(0, 200).map((entry) => ({
          ...entry,
          id: entry.id.slice(0, 2_000),
          text: entry.text.slice(0, 16_384),
        })),
      }
    case 'request':
      return {
        ...event,
        requestId: event.requestId.slice(0, 2_000),
        title: event.title.slice(0, 500),
        detail: sliceText(event.detail, 16_384),
        options: event.options?.slice(0, 100).map((option) => ({
          ...option,
          id: option.id.slice(0, 2_000),
          label: option.label.slice(0, 500),
        })),
        questions: event.questions?.slice(0, 50).map(boundedQuestion),
      }
    case 'request_resolved':
      return event
    case 'artifact':
      return {
        ...event,
        artifactId: event.artifactId.slice(0, 2_000),
        title: event.title.slice(0, 500),
        mediaType: sliceText(event.mediaType, 200),
      }
    case 'file_change':
      return {
        ...event,
        path: sliceText(event.path, 4_096),
        summary: sliceText(event.summary, 16_384),
        subagentId: sliceText(event.subagentId, 2_000),
      }
    case 'terminal':
      return {
        ...event,
        terminalSessionId: event.terminalSessionId.slice(0, 2_000),
        title: event.title.slice(0, 500),
      }
    case 'error':
      return {
        ...event,
        code: event.code.slice(0, 200),
        message: safeProviderMessage(event.message, 'Provider reported an error.', secretValues),
      }
    case 'diagnostic':
      return {
        ...event,
        message: safeProviderMessage(event.message, 'Provider reported a diagnostic.', secretValues),
      }
    case 'subagent':
      return {
        ...event,
        subagent: {
          ...event.subagent,
          id: event.subagent.id.slice(0, 2_000),
          title: sliceText(event.subagent.title, 500),
          role: sliceText(event.subagent.role, 200),
          model: sliceText(event.subagent.model, 200),
          providerAgentRef: sliceText(event.subagent.providerAgentRef, 2_000),
          // Clamped rather than sliced: these reach the sidebar as numbers, and a provider reporting a
          // nonsense count should not render as one.
          toolUseCount: boundedCount(event.subagent.toolUseCount),
          durationMs: boundedCount(event.subagent.durationMs),
        },
      }
    case 'usage':
    case 'turn_completed':
      return event
  }
}
