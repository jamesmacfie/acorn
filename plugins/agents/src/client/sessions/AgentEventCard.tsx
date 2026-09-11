import { createSignal, For, Index, Show } from 'solid-js'
import type { AgentConversationItem } from './conversationItems'
import type { AgentNormalizedEvent, AgentPlanEntry, AgentRequest, AgentTurn, AgentUsage } from '@acorn/protocol/managedAgents.ts'
import AgentMarkdown from './ManagedAgentMarkdown'
import { dispatchLayout, requestTerminalFocus, saveFile, setTerminalOpen } from '@acorn/plugin-api/client'
import { managedAgentApi } from './managedClient'
import { downloadName } from './downloadName'
import { AgentToolCallCard } from './toolRendererRegistry'
import {
  Alert, Button, Card, CodeBlock, Fold, Heading, Icon, Inline, Menu, Row, Stack, Text,
} from '@acorn/plugin-api/ui'
import { SubagentStateIcon } from './RuntimeStateIcon'
import { subagentSummary } from './subagentDisplay'
import { selectManagedSubagent } from './managedSelection'
import { visibleConversationItems } from './conversationItems'
import { asPlainText } from './copyFormats'
import { askedQuestions, askWasAbandoned } from './requestAnswers'

// One event of a session, as a card in the transcript's `Timeline`. Thirteen kinds, and the tool call
// is the fourteenth: it is a `Slot`, so another plugin may draw it (./toolRendererRegistry.tsx).

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
  await saveFile({ bytes, mimeType: type, suggestedName: filename ?? (downloadName(title, 180) || 'artifact') })
}

// The reader's way out of the transcript. Three formats because the answer lands in three kinds of
// place: prose in a chat or a ticket, markdown in a doc, and the raw event when somebody is debugging
// what the harness actually sent. It mirrors the session's own export menu in the pane header, one
// answer at a time instead of the whole history.
function CopyOutputMenu(props: { text: () => string; event: () => AgentNormalizedEvent }) {
  const copy = (text: string) => void navigator.clipboard.writeText(text)
  return (
    <Menu ariaLabel="Copy this response" placement="bottom-end"
      trigger={({ toggle, open }) => (
        <Button
          variant="bare"
          size="sm"
          iconOnly
          label="Copy this response"
          opens="menu"
          expanded={open()}
          onPress={toggle}
        >
          <Icon name="ellipsis" />
        </Button>
      )}
    >
      {(menu) => (
        <>
          <Menu.Item context={menu} onSelect={() => copy(asPlainText(props.text()))}>Copy as text</Menu.Item>
          <Menu.Item context={menu} onSelect={() => copy(props.text())}>Copy as Markdown</Menu.Item>
          <Menu.Item context={menu} onSelect={() => copy(JSON.stringify(props.event(), null, 2))}>Copy as JSON</Menu.Item>
        </>
      )}
    </Menu>
  )
}

export default function AgentEventCard(props: {
  item: AgentConversationItem
  taskId: string
  sessionId: string
  /** The session's own model, which a subagent card shows when the harness never named the child's. */
  sessionModel?: string
  turn?: AgentTurn
  /** The live row behind a `request` event: what it was answered with, and whether it still can be. */
  request?: AgentRequest
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
            // The same card the reader's own turn gets, in the other stripe colour: the two sides of
            // the conversation are the pair that has to be told apart at a glance, and everything
            // else in the stream is a tool call or a note rather than somebody talking.
            <Card pad="sm" stripe="ok">
              <Stack gap="row">
                <Inline>
                  <Text emphasis="eyebrow">Agent</Text>
                  <CopyOutputMenu text={() => message().text} event={message} />
                </Inline>
                <AgentMarkdown text={message().text} taskId={props.taskId} />
              </Stack>
            </Card>
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
      {/*
        A question the agent asked, after it was answered. The card above the stream is the one that
        takes the answer and it leaves with the question; this is what the thread keeps, and the fold is
        the part nothing else records: what the reader could have said and did not.
      */}
      <Show when={event().type === 'request'}>
        {(_shown) => {
          const asked = () => event() as Extract<ReturnType<typeof event>, { type: 'request' }>
          const waiting = () => !askWasAbandoned(props.request)
            && props.request?.status !== 'resolved'
          return (
            <Card pad="sm">
              <Stack gap="row">
                <Heading level={3} eyebrow={asked().kind}>{asked().title}</Heading>
                <For each={askedQuestions(asked(), props.request)}>
                  {(entry) => (
                    <Stack gap="row">
                      <Show when={entry.prompt !== asked().title}>
                        <Text emphasis="muted" wrap>{entry.prompt}</Text>
                      </Show>
                      <Show
                        when={entry.chosen.length}
                        fallback={
                          <Text emphasis="muted">{waiting() ? 'Waiting for an answer' : 'No answer'}</Text>
                        }
                      >
                        <Text wrap>{entry.chosen.join(', ')}</Text>
                      </Show>
                      <Show when={entry.alternatives.length}>
                        <Fold label="Options not chosen" level="sub">
                          <Stack gap="row">
                            <For each={entry.alternatives}>
                              {(option) => (
                                <Text emphasis="muted" wrap>
                                  {option.description ? `${option.label} · ${option.description}` : option.label}
                                </Text>
                              )}
                            </For>
                          </Stack>
                        </Fold>
                      </Show>
                    </Stack>
                  )}
                </For>
              </Stack>
            </Card>
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
