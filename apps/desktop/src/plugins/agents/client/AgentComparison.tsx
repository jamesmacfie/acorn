import { createResource, For, Show } from 'solid-js'
import type { Task } from '../../../core/client/queries'
import type { AgentSession, AgentSessionSnapshot, AgentUsage } from '../../../core/shared/managedAgents'
import { managedAgentApi } from './managedClient'

type ComparisonSummary = {
  snapshot: AgentSessionSnapshot
  changedFiles: string[]
  tools: number
  failures: number
  usage: AgentUsage
  outcome: string
}

const addUsage = (summary: AgentUsage, usage: AgentUsage): void => {
  summary.inputTokens = (summary.inputTokens ?? 0) + (usage.inputTokens ?? 0)
  summary.outputTokens = (summary.outputTokens ?? 0) + (usage.outputTokens ?? 0)
  summary.cachedInputTokens = (summary.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0)
  if (usage.cost) {
    const currency = summary.cost?.currency ?? usage.cost.currency
    if (currency === usage.cost.currency) {
      summary.cost = { currency, amount: (summary.cost?.amount ?? 0) + usage.cost.amount }
    }
  }
}

const summarize = (snapshot: AgentSessionSnapshot): ComparisonSummary => {
  const changedFiles = new Set<string>()
  let tools = 0
  let failures = 0
  let outcome = ''
  const usage: AgentUsage = {}
  for (const record of snapshot.events) {
    if (record.event.type === 'file_change' && record.event.path) changedFiles.add(record.event.path)
    else if (record.event.type === 'tool') {
      tools++
      if (record.event.tool.status === 'failed') failures++
    } else if (record.event.type === 'error') failures++
    else if (record.event.type === 'usage') addUsage(usage, record.event.usage)
    else if (record.event.type === 'assistant_message' && record.event.text.trim()) {
      outcome = record.event.text.trim()
    }
  }
  return {
    snapshot,
    changedFiles: [...changedFiles].sort(),
    tools,
    failures,
    usage,
    outcome: outcome.slice(0, 500),
  }
}

export default function AgentComparison(props: {
  sessions: AgentSession[]
  tasks: Map<string, Task>
  onOpen: (session: AgentSession) => void
  onClose: () => void
}) {
  const [summaries] = createResource(
    () => props.sessions.map((session) => session.id).join(','),
    async () => Promise.all(props.sessions.map(async (session) =>
      summarize(await managedAgentApi.snapshot(session.id, 0, 2_000)))),
  )

  return (
    <section class="agent-comparison" aria-label="Agent outcome comparison">
      <header>
        <div>
          <span class="agent-center-kicker">Independent outcomes</span>
          <h2>Compare agent sessions</h2>
        </div>
        <button type="button" class="ui-btn" onClick={props.onClose}>Close comparison</button>
      </header>
      <Show when={!summaries.loading} fallback={<div class="agent-center-empty">Loading histories…</div>}>
        <div class="agent-comparison-grid" style={{ '--agent-comparison-count': String(props.sessions.length) }}>
          <For each={summaries() ?? []}>
            {(summary) => {
              const session = summary.snapshot.session
              const task = props.tasks.get(session.taskId)
              return (
                <article>
                  <div class="agent-comparison-provider">{session.providerId}</div>
                  <h3>{session.title}</h3>
                  <p class="muted">{task?.title ?? session.taskId}</p>
                  <dl>
                    <div><dt>Result</dt><dd>{session.runtimeState}</dd></div>
                    <div><dt>Files changed</dt><dd>{summary.changedFiles.length}</dd></div>
                    <div><dt>Tool calls</dt><dd>{summary.tools}</dd></div>
                    <div><dt>Failures</dt><dd>{summary.failures}</dd></div>
                    <div><dt>Tokens</dt><dd>{(summary.usage.inputTokens ?? 0) + (summary.usage.outputTokens ?? 0) || '—'}</dd></div>
                    <div><dt>Cost</dt><dd>{summary.usage.cost ? `${summary.usage.cost.amount.toFixed(4)} ${summary.usage.cost.currency}` : '—'}</dd></div>
                  </dl>
                  <Show when={summary.changedFiles.length}>
                    <details>
                      <summary>Changed files</summary>
                      <ul><For each={summary.changedFiles}>{(path) => <li>{path}</li>}</For></ul>
                    </details>
                  </Show>
                  <Show when={summary.outcome}>
                    <p class="agent-comparison-outcome">{summary.outcome}</p>
                  </Show>
                  <button type="button" class="ui-btn" onClick={() => props.onOpen(session)}>Open session</button>
                </article>
              )
            }}
          </For>
        </div>
      </Show>
    </section>
  )
}
