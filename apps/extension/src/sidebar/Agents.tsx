import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import type { BridgeAgentChoice, BridgeAgentSession, BridgePendingRequest } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Fold, Section } from '@acorn/client-core/kit/components/layout'
import { Chip, EmptyState, Row } from '@acorn/client-core/kit/components/primitives.tsx'
import { brandMarkRegistry } from '@acorn/client-core/kit/tokens'
import { formatRelativeTime } from '@acorn/dashboards-core/relativeTime.ts'
import { runtimeIcon, runtimeTone } from '@acorn/plugin-agents/contract/runtimeState.ts'
import type { PageCapture } from '../capture'
import { AgentPicker, agentChoice } from './agentChoice'
import type { BridgeClient } from './bridgeClient'
import { CAPTURE_NAMES } from './Composer'
import { NeedsYou, type RequestReads } from './NeedsYou'
import { agentState } from './state'

// The folds under Managed sessions, named as the desktop app's Agents sidebar names them.
const FOLDS: { label: string; has(session: BridgeAgentSession): boolean }[] = [
  { label: 'Workflow runs', has: (session) => !session.inline && !session.btw && session.kind === 'workflow' },
  { label: 'Inline chats', has: (session) => session.inline },
  { label: 'Side questions', has: (session) => session.btw },
]
const managed = (session: BridgeAgentSession) => !session.inline && !session.btw && session.kind !== 'workflow'

// A provider's logo, when the agents plugin has one for it (main.tsx registers them).
const providerMark = (providerId: string) =>
  brandMarkRegistry.get(`agents/${providerId}`) ? `brand:agents/${providerId}` : undefined

// A task's Agents tab, laid out as the desktop's Agents sidebar: the task's Needs you list while an
// agent waits, Managed sessions with New chat in its header, then Workflow runs, Inline chats, and Side
// questions as folds. A task with no conversation shows an empty state instead. The item waiting for the task's next
// chat shows as a chip in either. docs/browser-extension/conversations.md.
export function Agents(props: {
  client: BridgeClient
  nodeId: string
  taskId: string
  online: boolean
  sessions: readonly BridgeAgentSession[] | null
  // Every request the Node's agents wait on. The tab shows its task's.
  requests: readonly BridgePendingRequest[]
  reads: RequestReads
  pendingItem: PageCapture | null
  dropPendingItem(): void
  // Which folds are open, by label. Workspace holds it, so it lasts as long as the panel.
  folds: Record<string, boolean>
  fold(label: string, open: boolean): void
  open(sessionId: string): void
  started(session: BridgeAgentSession): void
}) {
  const requests = () => props.requests.filter((request) => request.taskId === props.taskId)
  const waiting = (sessionId: string) => requests().some((request) => request.sessionId === sessionId)

  const agents = agentChoice(props.client, props.nodeId)
  onMount(() => void agents.load())
  const start = async (choice: BridgeAgentChoice) => {
    const session = await agents.start(props.taskId, choice)
    if (session) props.started(session)
  }
  const picker = (label: string, solid = false) => (
    <AgentPicker
      label={label}
      solid={solid}
      agents={agents}
      disabled={!props.online}
      pick={(choice) => void start(choice)}
    />
  )

  // The item waiting for the next chat started or opened here.
  const pending = () => (
    <Show when={props.pendingItem}>
      {(item) => (
        <span class="pending-item" aria-label="Pending item">
          <Chip
            leading={<Icon name={item().kind === 'link' ? 'link' : 'file-text'} />}
            onRemove={() => props.dropPendingItem()}
          >
            {CAPTURE_NAMES[item().kind]} · {item().title}
          </Chip>
          <span>Goes with your first message.</span>
        </span>
      )}
    </Show>
  )

  // Each row's age moves on while the tab is open.
  const [now, setNow] = createSignal(Date.now())
  const clock = setInterval(() => setNow(Date.now()), 60_000)
  onCleanup(() => clearInterval(clock))

  const rows = (label: string, sessions: readonly BridgeAgentSession[]) => (
    <ul class="agent-rows" aria-label={label}>
      <For each={sessions}>
        {(session) => (
          <SessionRow session={session} waiting={waiting(session.id)} now={now()} open={() => props.open(session.id)} />
        )}
      </For>
    </ul>
  )

  return (
    <>
      <NeedsYou
        client={props.client}
        nodeId={props.nodeId}
        requests={requests()}
        reads={props.reads}
        online={props.online}
        inTask
        openConversation={(_taskId, sessionId) => props.open(sessionId)}
      />
      <Show when={props.sessions} fallback={<p class="empty quiet">Loading conversations…</p>}>
        {(sessions) => (
          <Show
            when={sessions().length}
            fallback={
              <EmptyState
                icon={<Icon name="bot" size="2em" />}
                title="No chats in this task"
                action={picker('Start a chat', true)}
              >
                {pending()}
              </EmptyState>
            }
          >
            <div class="agents">
              <Show when={props.pendingItem}>
                <div class="pending">{pending()}</div>
              </Show>
              <Section label="Managed sessions" actions={picker('New chat')}>
                <Show
                  when={sessions().filter(managed).length}
                  fallback={
                    <EmptyState size="sm" align="start">
                      No managed sessions
                    </EmptyState>
                  }
                >
                  {rows('Managed sessions', sessions().filter(managed))}
                </Show>
              </Section>
              <For each={FOLDS}>
                {(group) => (
                  <Show when={sessions().filter(group.has).length}>
                    <Fold
                      label={group.label}
                      count={sessions().filter(group.has).length}
                      open={props.folds[group.label] ?? false}
                      onOpenChange={(open) => props.fold(group.label, open)}
                    >
                      {rows(group.label, sessions().filter(group.has))}
                    </Fold>
                  </Show>
                )}
              </For>
            </div>
          </Show>
        )}
      </Show>
      <Show when={agents.problem()}>
        {(message) => (
          <p class="empty problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </>
  )
}

// A conversation as the desktop's stacked row: its state as an icon, the title, and the provider's
// logo with the model under it. The amber alert leads while the agent waits on the person, and trails
// again beside the time since the conversation last changed.
function SessionRow(props: { session: BridgeAgentSession; waiting: boolean; now: number; open(): void }) {
  const icon = () => runtimeIcon(props.session.runtimeState)
  const mark = () => providerMark(props.session.providerId)
  return (
    <li>
      <Row
        variant="stacked"
        onPress={() => props.open()}
        leading={
          // The loader turns, as a working session's does on the desktop. The state's words are the
          // icon's name, since the row doesn't write them out.
          <Icon
            name={props.waiting ? 'circle-alert' : icon()}
            tone={props.waiting ? 'warn' : runtimeTone(props.session.runtimeState)}
            spin={!props.waiting && icon() === 'loader-circle'}
            title={agentState(props.session, props.waiting)}
          />
        }
        trailing={
          <>
            <Show when={props.waiting}>
              <Icon name="circle-alert" tone="warn" />
            </Show>
            <span>{formatRelativeTime(props.session.updatedAt, props.now)}</span>
          </>
        }
      >
        <strong class="row-title">{props.session.title}</strong>
        <span class="row-meta agent-meta">
          <Show when={mark()}>{(name) => <Icon name={name()} tone="brand" title={props.session.providerId} />}</Show>
          {/* A provider with no logo is named in words. */}
          <span>{[!mark() && props.session.providerId, props.session.model].filter(Boolean).join(' · ')}</span>
        </span>
      </Row>
    </li>
  )
}
