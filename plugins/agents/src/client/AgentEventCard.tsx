import { For, Show } from 'solid-js'
import type { AgentConversationItem } from './conversationItems'
import type { AgentTurn } from '@acorn/protocol/managedAgents.ts'
import AgentMarkdown from './ManagedAgentMarkdown'
import { dispatchLayout, setTerminalOpen } from '@acorn/client-core/tasks/tasks.ts'
import { requestTerminalFocus } from '@acorn/client-core/tasks/agentSessions.ts'
import { managedAgentApi } from './managedClient'
import { AgentToolCallCard } from './toolRendererRegistry'
import { Button } from '@acorn/client-core/ui/primitives.tsx'

const copy = (text: string): void => {
  void navigator.clipboard.writeText(text)
}

// An artifact used to be a plain `href` to its content route. That only ever worked while the renderer
// shared an origin with the node; from app:// the URL resolves against the renderer's own protocol
// handler and 404s into index.html, and the bearer lives in main either way. So fetch the bytes through
// the broker and hand the browser a blob URL — the same shape AgentPane's transcript export uses.
async function downloadArtifact(artifactId: string, title: string): Promise<void> {
  const { bytes, type, filename } = await managedAgentApi.artifactContent(artifactId)
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? (title.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 180) || 'artifact')
  anchor.click()
  URL.revokeObjectURL(url)
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
                      <Button
                        disabled={!context.deepLink}
                        onClick={() => context.deepLink && dispatchLayout(props.taskId, { type: 'show', pane: context.deepLink.pane })}
                      >
                        <span>{context.label}</span>
                        <small>
                          {context.source} · {context.freshness ?? 'unknown'} · ~{(context.estimatedTokens ?? 0).toLocaleString()} tok
                        </small>
                        <small>{context.provenance}</small>
                      </Button>
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
                <Button variant="bare" size="sm" class="agent-copy" title="Copy response" onClick={() => copy(message.text)}>Copy</Button>
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
            <Button class="agent-artifact-link" onClick={openChanges}>
              <span>Changed {change.path ?? 'files'}</span>
              <span class="muted">{change.summary ?? 'Open in Changes'} →</span>
            </Button>
          )
        })()}
      </Show>
      <Show when={event().type === 'terminal'}>
        {(() => {
          const terminal = event() as Extract<ReturnType<typeof event>, { type: 'terminal' }>
          return (
            <Button class="agent-artifact-link" onClick={() => {
              setTerminalOpen(props.taskId, true)
              requestTerminalFocus(props.taskId, terminal.terminalSessionId)
            }}>
              <span>{terminal.title}</span><span class="muted">Open terminal →</span>
            </Button>
          )
        })()}
      </Show>
      <Show when={event().type === 'artifact'}>
        {(() => {
          const artifact = event() as Extract<ReturnType<typeof event>, { type: 'artifact' }>
          return (
            <Button class="agent-artifact-link" onClick={() => void downloadArtifact(artifact.artifactId, artifact.title)}>
              <span>{artifact.title}</span>
              <span class="muted">
                {artifact.byteSize == null ? '' : `${Math.max(1, Math.round(artifact.byteSize / 1024)).toLocaleString()} KiB · `}
                Download →
              </span>
            </Button>
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
