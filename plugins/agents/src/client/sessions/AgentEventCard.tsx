import { createSignal, For, Index, Show } from 'solid-js'
import type { AgentConversationItem } from './conversationItems'
import type { AgentPlanEntry, AgentTurn, AgentUsage } from '@acorn/protocol/managedAgents.ts'
import AgentMarkdown from './ManagedAgentMarkdown'
import { dispatchLayout, requestTerminalFocus, setTerminalOpen } from '@acorn/plugin-api/client'
import { managedAgentApi } from './managedClient'
import { AgentToolCallCard } from './toolRendererRegistry'
import {
  Alert, Button, Card, CodeBlock, CopyButton, Fold, Icon, Inline, Row, Stack, Text,
} from '@acorn/plugin-api/ui'
import { SubagentStateIcon } from './RuntimeStateIcon'
import { subagentSummary } from './subagentDisplay'
import { selectManagedSubagent } from './managedSelection'
import { visibleConversationItems } from './conversationItems'

// One event of a session, as a card in the transcript's `Timeline`. Eleven kinds, and the tool call
// is the twelfth: it is a `Slot`, so another plugin may draw it (./toolRendererRegistry.tsx).

// Both of these build their whole string in one call, so the card can read the event through a getter
// rather than freezing a copy of it. See the note on Show's children below.
const usageLine = (usage: AgentUsage): string => [
  usage.inputTokens != null ? `${usage.inputTokens.toLocaleString()} in` : '',
  usage.outputTokens != null ? `${usage.outputTokens.toLocaleString()} out` : '',
  usage.contextUsed != null && usage.contextSize != null
    ? `${usage.contextUsed.toLocaleString()} / ${usage.contextSize.toLocaleString()} context`
    : '',
  usage.cost ? `${usage.cost.amount.toFixed(4)} ${usage.cost.currency}` : '',
].filter(Boolean).join(' · ')

const artifactSize = (byteSize?: number): string =>
  byteSize == null ? '' : `${Math.max(1, Math.round(byteSize / 1024)).toLocaleString()} KiB · `

const PLAN_STATUS: Record<AgentPlanEntry['status'], { icon: string; tone: 'muted' | 'accent' | 'ok'; label: string }> = {
  pending: { icon: 'circle', tone: 'muted', label: 'Pending' },
  in_progress: { icon: 'circle-dot', tone: 'accent', label: 'In progress' },
  completed: { icon: 'circle-check', tone: 'ok', label: 'Completed' },
}

async function downloadArtifact(artifactId: string, title: string): Promise<void> {
  const { bytes, type, filename } = await managedAgentApi.artifactContent(artifactId)
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? (title.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 180) || 'artifact')
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function AgentEventCard(props: {
  item: AgentConversationItem
  taskId: string
  sessionId: string
  /** The session's own model, which a subagent card shows when the harness never named the child's. */
  sessionModel?: string
  turn?: AgentTurn
}) {
  const event = () => props.item.event
  const openChanges = () => dispatchLayout(props.taskId, { type: 'show', pane: 'changes' })

  return (
    <>
      {/*
        Every branch below uses Show's callback child form, `{(_shown) => ...}`, and reads the event
        through a getter. Solid calls that callback untracked, which is the whole point: Show reads its
        children inside its own memo, so a branch that touched `event()` while building itself made the
        memo depend on it — and buildConversationItems hands out a fresh event object per snapshot, so
        every arriving message rebuilt the DOM of every card. Anything the reader had opened went with
        it: an open fold snapped shut, and the fold state below reseeded from the new event.
      */}
      <Show when={event().type === 'user_message'}>
        {(_shown) => {
          const message = () => event() as Extract<ReturnType<typeof event>, { type: 'user_message' }>
          return (
            <Card pad="sm" stripe="accent">
              <Stack gap="row">
                <Text emphasis="eyebrow">You</Text>
                <AgentMarkdown text={message().text} taskId={props.taskId} />
                <Show when={props.turn?.input.some((part) => part.type === 'context')}>
                  <Fold label="Context manifest" level="sub">
                    <Stack gap="row">
                      <For each={props.turn?.input.filter((part) => part.type === 'context') ?? []}>
                        {(context) => (
                          <Row
                            variant="stacked"
                            density="compact"
                            onPress={context.deepLink
                              ? () => dispatchLayout(props.taskId, { type: 'show', pane: context.deepLink!.pane })
                              : undefined}
                            meta={<Text emphasis="muted">~{(context.estimatedTokens ?? 0).toLocaleString()} tok</Text>}
                          >
                            <Text emphasis="strong">{context.label}</Text>
                            <Text emphasis="muted">
                              {context.source} · {context.freshness ?? 'unknown'} · {context.provenance}
                            </Text>
                          </Row>
                        )}
                      </For>
                      <Show when={Object.keys(props.turn?.effectivePolicy ?? {}).length}>
                        <CodeBlock size="xs" wrap>{JSON.stringify(props.turn?.effectivePolicy, null, 2)}</CodeBlock>
                      </Show>
                    </Stack>
                  </Fold>
                </Show>
              </Stack>
            </Card>
          )
        }}
      </Show>
      <Show when={event().type === 'assistant_message'}>
        {(_shown) => {
          const message = () => event() as Extract<ReturnType<typeof event>, { type: 'assistant_message' }>
          return (
            <Stack gap="row">
              <Inline>
                <Text emphasis="eyebrow">Agent</Text>
                <CopyButton text={() => message().text} title="Copy response" />
              </Inline>
              <AgentMarkdown text={message().text} taskId={props.taskId} />
            </Stack>
          )
        }}
      </Show>
      <Show when={event().type === 'reasoning'}>
        {(_shown) => {
          const reasoning = () => event() as Extract<ReturnType<typeof event>, { type: 'reasoning' }>
          return (
            <Fold label="Thinking" level="sub" meta={<Text emphasis="muted">Provider reasoning</Text>} defaultOpen>
              <AgentMarkdown text={reasoning().text} taskId={props.taskId} />
            </Fold>
          )
        }}
      </Show>
      <Show when={event().type === 'tool'}>
        {(_shown) => {
          const tool = () => (event() as Extract<ReturnType<typeof event>, { type: 'tool' }>).tool
          return <AgentToolCallCard tool={tool()} taskId={props.taskId} />
        }}
      </Show>
      <Show when={event().type === 'subagent'}>
        {(_shown) => {
          const subagent = () => (event() as Extract<ReturnType<typeof event>, { type: 'subagent' }>).subagent
          const children = () => visibleConversationItems(props.item.children ?? [])
          // Seeded once, then the reader's own. Expanded while the subagent is working, because watching
          // it is the point; collapsed if it had already settled when this card was first rendered,
          // because a long finished run buries the parent's stream and there is a dedicated view for it.
          // A reactive `open` would instead slam the card shut the moment the subagent finished, which
          // is exactly when somebody is most likely to be reading it.
          const [open, setOpen] = createSignal(
            subagent().status === undefined || subagent().status === 'running' || subagent().status === 'pending')
          return (
            <Fold
              label={subagent().title ?? 'Subagent'}
              level="sub"
              open={open()}
              onOpenChange={setOpen}
              meta={
                <Inline>
                  <SubagentStateIcon status={subagent().status} />
                  <Text emphasis="muted">{subagentSummary(subagent(), props.sessionModel)}</Text>
                </Inline>
              }
              // Straight to the dedicated view, for a run too long to read in a box. Fold isolates a
              // click on its actions from the toggle underneath.
              actions={
                <Button
                  variant="bare"
                  size="sm"
                  onPress={() => selectManagedSubagent(props.sessionId, subagent().id)}
                >
                  Open
                </Button>
              }
            >
              {/* `Index`, not `For`, for the reason AgentTranscript states: buildConversationItems
                  rebuilds every item object on every snapshot, so reference keying would replace this
                  DOM, and any selection in it, on each streamed event. */}
              <Stack gap="row">
                <Index each={children()}>
                  {(child) => (
                    <AgentEventCard
                      item={child()}
                      taskId={props.taskId}
                      sessionId={props.sessionId}
                      sessionModel={props.sessionModel}
                      turn={props.turn}
                    />
                  )}
                </Index>
              </Stack>
            </Fold>
          )
        }}
      </Show>
      <Show when={event().type === 'plan'}>
        <Card pad="sm">
          <Stack gap="row">
            <Text emphasis="eyebrow">Plan</Text>
            <For each={(event() as Extract<ReturnType<typeof event>, { type: 'plan' }>).entries}>
              {(entry) => (
                <Inline>
                  <Icon
                    name={PLAN_STATUS[entry.status].icon}
                    tone={PLAN_STATUS[entry.status].tone}
                    title={PLAN_STATUS[entry.status].label}
                  />
                  <AgentMarkdown text={entry.text} taskId={props.taskId} />
                </Inline>
              )}
            </For>
          </Stack>
        </Card>
      </Show>
      <Show when={event().type === 'file_change'}>
        {(_shown) => {
          const change = () => event() as Extract<ReturnType<typeof event>, { type: 'file_change' }>
          return (
            <Row
              leading={<Icon name="file-diff" />}
              meta={<Text emphasis="muted">{change().summary ?? 'Open in Changes'} →</Text>}
              onPress={openChanges}
            >
              Changed {change().path ?? 'files'}
            </Row>
          )
        }}
      </Show>
      <Show when={event().type === 'terminal'}>
        {(_shown) => {
          const terminal = () => event() as Extract<ReturnType<typeof event>, { type: 'terminal' }>
          return (
            <Row
              leading={<Icon name="square-terminal" />}
              meta={<Text emphasis="muted">Open terminal →</Text>}
              onPress={() => {
                setTerminalOpen(props.taskId, true)
                requestTerminalFocus(props.taskId, terminal().terminalSessionId)
              }}
            >
              {terminal().title}
            </Row>
          )
        }}
      </Show>
      <Show when={event().type === 'artifact'}>
        {(_shown) => {
          const artifact = () => event() as Extract<ReturnType<typeof event>, { type: 'artifact' }>
          return (
            <Row
              leading={<Icon name="paperclip" />}
              meta={<Text emphasis="muted">{artifactSize(artifact().byteSize)}Download →</Text>}
              onPress={() => void downloadArtifact(artifact().artifactId, artifact().title)}
            >
              {artifact().title}
            </Row>
          )
        }}
      </Show>
      <Show when={event().type === 'usage'}>
        {(_shown) => {
          const usage = () => (event() as Extract<ReturnType<typeof event>, { type: 'usage' }>).usage
          return <Text emphasis="muted" wrap>{usageLine(usage())}</Text>
        }}
      </Show>
      <Show when={event().type === 'error'}>
        {(_shown) => {
          const error = () => event() as Extract<ReturnType<typeof event>, { type: 'error' }>
          return <Alert title={error().code}>{error().message}</Alert>
        }}
      </Show>
      <Show when={event().type === 'diagnostic'}>
        <Text emphasis="muted" wrap>
          {(event() as Extract<ReturnType<typeof event>, { type: 'diagnostic' }>).message}
        </Text>
      </Show>
      <Show when={event().type === 'turn_completed'}>
        <Text emphasis="muted">
          Turn complete
          {(event() as Extract<ReturnType<typeof event>, { type: 'turn_completed' }>).stopReason
            ? ` · ${(event() as Extract<ReturnType<typeof event>, { type: 'turn_completed' }>).stopReason}`
            : ''}
        </Text>
      </Show>
    </>
  )
}
