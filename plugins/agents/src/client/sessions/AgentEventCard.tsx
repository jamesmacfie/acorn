import { createSignal, For, Index, Show } from 'solid-js'
import type { AgentConversationItem } from './conversationItems'
import type { AgentNormalizedEvent, AgentPlanEntry, AgentRequest, AgentTurn } from '@acorn/protocol/managedAgents.ts'
import AgentMarkdown from './ManagedAgentMarkdown'
import { dispatchLayout, requestTerminalFocus, setTerminalOpen } from '@acorn/plugin-api/client'
import { AgentToolCallCard } from './toolRendererRegistry'
import {
  Alert, Button, Card, CodeBlock, Fold, Heading, Icon, Inline, Menu, Row, Stack, Text,
} from '@acorn/plugin-api/ui'
import { SubagentStateIcon } from './RuntimeStateIcon'
import { subagentSummary } from './subagentDisplay'
import { selectManagedSubagent } from './managedSelection'
import { visibleConversationItems } from './conversationItems'
import { asPlainText } from './copyFormats'
import AgentRequestCard from './AgentRequestCard'
import { askedQuestions } from './requestAnswers'
import AgentArtifactCard from './AgentArtifactCard'
import AgentAttachmentCard from './AgentAttachmentCard'

// One event of a session, as a card in the transcript's `Timeline`. Thirteen kinds, and the tool call
// is the fourteenth: it is a `Slot`, so another plugin may draw it (./toolRendererRegistry.tsx).

// Builds its whole string in one call, so the card can read the item through a getter rather than
// freezing a copy of it. See the note on Show's children below.
const contextLine = (context: { used: number; size?: number }): string =>
  context.size === undefined
    ? `${context.used.toLocaleString()} tokens`
    : `${context.used.toLocaleString()} / ${context.size.toLocaleString()} context`

// The turn's text names each attachment as `[Attachment: <id>]`, which is what the harness is sent
// (server/sessions/runtimeContext.ts). Once the cards below draw the attachments themselves, the
// placeholder is the same fact twice, and the uglier of the two. Dropped only when there are cards to
// draw: a truncated replay can reach a card with no turn behind it, and a reader who loses the line
// entirely has no idea anything was attached.
export const withoutAttachmentPlaceholders = (text: string): string =>
  text.replace(/^\[Attachment: [^\]\n]+\]$/gm, '').replace(/\n{3,}/g, '\n\n').trim()

const PLAN_STATUS: Record<AgentPlanEntry['status'], { icon: string; tone: 'muted' | 'accent' | 'ok'; label: string }> = {
  pending: { icon: 'circle', tone: 'muted', label: 'Pending' },
  in_progress: { icon: 'circle-dot', tone: 'accent', label: 'In progress' },
  completed: { icon: 'circle-check', tone: 'ok', label: 'Completed' },
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
  /** Bring this request's card to the reader, for the notice or sidebar row that named it. */
  focusRequest?: boolean
  onRequestResolved?: () => void
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
          const attachments = () =>
            props.turn?.input.filter((part) => part.type === 'attachment' || part.type === 'image') ?? []
          return (
            <Card pad="sm" stripe="accent">
              <Stack gap="row">
                <Text emphasis="eyebrow">You</Text>
                <AgentMarkdown
                  text={attachments().length ? withoutAttachmentPlaceholders(message().text) : message().text}
                  taskId={props.taskId}
                />
                <Show when={attachments().length}>
                  <Inline wrap>
                    {/* Index, not For: the projection hands out a fresh input array on every snapshot,
                        and For keys by item identity, so a streaming session would remount these tiles
                        25 times a second and shut any open picture. A turn's parts never reorder. */}
                    <Index each={attachments()}>
                      {(part) => <AgentAttachmentCard attachmentId={part().attachmentId} />}
                    </Index>
                  </Inline>
                </Show>
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
                <Inline spread>
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
              nested
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
          return <AgentArtifactCard artifact={artifact()} />
        }}
      </Show>
      {/*
        Something the agent is blocked on, drawn at the point it asked. While it is blocking this is the
        card that takes the answer; afterwards it is the record of what was said, and the fold holds the
        part nothing else keeps: what the reader could have said and did not.
      */}
      <Show when={event().type === 'request'}>
        {(_shown) => {
          const asked = () => event() as Extract<ReturnType<typeof event>, { type: 'request' }>
          // Still waiting on somebody, so the card that takes the answer is the card, drawn where the
          // agent asked rather than in a strip above everything that has happened since.
          const open = () => {
            const request = props.request
            const waiting = request?.status === 'pending' || request?.status === 'resolving'
            return waiting ? request : undefined
          }
          return (
            <Show when={!open()} fallback={
              <Show when={open()}>
                {(request) => (
                  <AgentRequestCard
                    request={request()}
                    focused={props.focusRequest}
                    onResolved={props.onRequestResolved}
                  />
                )}
              </Show>
            }>
            <Card pad="sm">
              <Stack gap="row">
                <Heading level={3} eyebrow={asked().kind}>{asked().title}</Heading>
                <Show when={askedQuestions(asked(), props.request).length} fallback={
                  <Text emphasis="muted">No answer</Text>
                }>
                <For each={askedQuestions(asked(), props.request)}>
                  {(entry) => (
                    <Stack gap="row">
                      <Show when={entry.prompt !== asked().title}>
                        <Text emphasis="muted" wrap>{entry.prompt}</Text>
                      </Show>
                      <Show
                        when={entry.chosen.length}
                        fallback={<Text emphasis="muted">No answer</Text>}
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
                </Show>
              </Stack>
            </Card>
            </Show>
          )
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
        {/* The turn's own footer: what ended it on the left, how much of the model's context window it
            had used on the right. The figure is stamped onto the item by the fold, because the usage
            that carries it is a separate event and often arrives after this one
            (./conversationItems.ts § stampTurnContext). */}
        <Inline spread>
          <Text emphasis="muted">
            Turn complete
            {(event() as Extract<ReturnType<typeof event>, { type: 'turn_completed' }>).stopReason
              ? ` · ${(event() as Extract<ReturnType<typeof event>, { type: 'turn_completed' }>).stopReason}`
              : ''}
          </Text>
          <Show when={props.item.context}>
            {(context) => <Text emphasis="muted">{contextLine(context())}</Text>}
          </Show>
        </Inline>
      </Show>
    </>
  )
}
