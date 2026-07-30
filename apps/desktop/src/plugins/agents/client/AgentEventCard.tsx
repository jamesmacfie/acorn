import { For, Show } from 'solid-js'
import type { AgentConversationItem } from './conversationItems'
import type { AgentTurn } from '../../../core/shared/managedAgents'
import AgentMarkdown from './ManagedAgentMarkdown'
import { dispatchLayout, setTerminalOpen } from '../../../core/client/tasks/tasks'
import { requestTerminalFocus } from '../../../core/client/tasks/agentSessions'
import { managedAgentApi } from './managedClient'
import { AgentToolCallCard } from './toolRendererRegistry'

const copy = (text: string): void => {
  void navigator.clipboard.writeText(text)
}

export default function AgentEventCard(props: { item: AgentConversationItem; taskId: string; turn?: AgentTurn }) {
  const event = () => props.item.event
  const openChanges = () => dispatchLayout(props.taskId, { type: 'show', pane: 'changes' })

  return (
    <article class="agent-event" data-event={event().type}>
      <Show when={event().type === 'user_message'}>
        {(() => {
          const message = event() as Extract<ReturnType<typeof event>, { type: 'user_message' }>
          return (
            <div class="agent-message agent-message-user">
              <div class="agent-message-role">You</div>
              <AgentMarkdown text={message.text} />
              <Show when={props.turn?.input.some((part) => part.type === 'context')}>
                <details class="agent-turn-manifest">
                  <summary>Context manifest</summary>
                  <For each={props.turn?.input.filter((part) => part.type === 'context') ?? []}>
                    {(context) => (
                      <button
                        type="button"
                        disabled={!context.deepLink}
                        onClick={() => context.deepLink && dispatchLayout(props.taskId, { type: 'show', pane: context.deepLink.pane })}
                      >
                        <span>{context.label}</span>
                        <small>
                          {context.source} · {context.freshness ?? 'unknown'} · ~{(context.estimatedTokens ?? 0).toLocaleString()} tok
                        </small>
                        <small>{context.provenance}</small>
                      </button>
                    )}
                  </For>
                  <Show when={Object.keys(props.turn?.effectivePolicy ?? {}).length}>
                    <pre>{JSON.stringify(props.turn?.effectivePolicy, null, 2)}</pre>
                  </Show>
                </details>
              </Show>
            </div>
          )
        })()}
      </Show>
      <Show when={event().type === 'assistant_message'}>
        {(() => {
          const message = event() as Extract<ReturnType<typeof event>, { type: 'assistant_message' }>
          return (
            <div class="agent-message agent-message-assistant">
              <div class="agent-message-head">
                <span class="agent-message-role">Agent</span>
                <button type="button" class="agent-copy" title="Copy response" onClick={() => copy(message.text)}>Copy</button>
              </div>
              <AgentMarkdown text={message.text} />
            </div>
          )
        })()}
      </Show>
      <Show when={event().type === 'reasoning'}>
        {(() => {
          const reasoning = event() as Extract<ReturnType<typeof event>, { type: 'reasoning' }>
          return (
            <details class="agent-reasoning" open>
              <summary>Thinking <span>Provider reasoning</span></summary>
              <AgentMarkdown text={reasoning.text} />
            </details>
          )
        })()}
      </Show>
      <Show when={event().type === 'tool'}>
        {(() => {
          const tool = (event() as Extract<ReturnType<typeof event>, { type: 'tool' }>).tool
          return <AgentToolCallCard tool={tool} taskId={props.taskId} />
        })()}
      </Show>
      <Show when={event().type === 'plan'}>
        <section class="agent-plan">
          <div class="agent-card-title">Plan</div>
          <ol>
            <For each={(event() as Extract<ReturnType<typeof event>, { type: 'plan' }>).entries}>
              {(entry) => <li data-state={entry.status}>{entry.status === 'completed' ? '✓' : entry.status === 'in_progress' ? '●' : '○'} {entry.text}</li>}
            </For>
          </ol>
        </section>
      </Show>
      <Show when={event().type === 'file_change'}>
        {(() => {
          const change = event() as Extract<ReturnType<typeof event>, { type: 'file_change' }>
          return (
            <button type="button" class="agent-artifact-link" onClick={openChanges}>
              <span>Changed {change.path ?? 'files'}</span>
              <span class="muted">{change.summary ?? 'Open in Changes'} →</span>
            </button>
          )
        })()}
      </Show>
      <Show when={event().type === 'terminal'}>
        {(() => {
          const terminal = event() as Extract<ReturnType<typeof event>, { type: 'terminal' }>
          return (
            <button type="button" class="agent-artifact-link" onClick={() => {
              setTerminalOpen(props.taskId, true)
              requestTerminalFocus(props.taskId, terminal.terminalSessionId)
            }}>
              <span>{terminal.title}</span><span class="muted">Open terminal →</span>
            </button>
          )
        })()}
      </Show>
      <Show when={event().type === 'artifact'}>
        {(() => {
          const artifact = event() as Extract<ReturnType<typeof event>, { type: 'artifact' }>
          return (
            <a
              class="agent-artifact-link"
              href={managedAgentApi.artifactContentUrl(artifact.artifactId)}
              download=""
            >
              <span>{artifact.title}</span>
              <span class="muted">
                {artifact.byteSize == null ? '' : `${Math.max(1, Math.round(artifact.byteSize / 1024)).toLocaleString()} KiB · `}
                Download →
              </span>
            </a>
          )
        })()}
      </Show>
      <Show when={event().type === 'usage'}>
        {(() => {
          const usage = (event() as Extract<ReturnType<typeof event>, { type: 'usage' }>).usage
          return (
            <div class="agent-usage-event muted">
              {usage.inputTokens != null ? `${usage.inputTokens.toLocaleString()} in` : ''}
              {usage.outputTokens != null ? ` · ${usage.outputTokens.toLocaleString()} out` : ''}
              {usage.contextUsed != null && usage.contextSize != null ? ` · ${usage.contextUsed.toLocaleString()} / ${usage.contextSize.toLocaleString()} context` : ''}
              {usage.cost ? ` · ${usage.cost.amount.toFixed(4)} ${usage.cost.currency}` : ''}
            </div>
          )
        })()}
      </Show>
      <Show when={event().type === 'error'}>
        {(() => {
          const error = event() as Extract<ReturnType<typeof event>, { type: 'error' }>
          return <div class="agent-error-card" role="alert"><strong>{error.code}</strong><span>{error.message}</span></div>
        })()}
      </Show>
      <Show when={event().type === 'diagnostic'}>
        <div class="agent-diagnostic muted">{(event() as Extract<ReturnType<typeof event>, { type: 'diagnostic' }>).message}</div>
      </Show>
      <Show when={event().type === 'turn_completed'}>
        <div class="agent-turn-complete">Turn complete{(event() as Extract<ReturnType<typeof event>, { type: 'turn_completed' }>).stopReason ? ` · ${(event() as Extract<ReturnType<typeof event>, { type: 'turn_completed' }>).stopReason}` : ''}</div>
      </Show>
    </article>
  )
}
