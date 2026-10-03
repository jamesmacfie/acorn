import { agentTelemetry, startAgentView } from './agentTelemetry'
import { createMemo, createEffect, onCleanup, Show } from 'solid-js'
import type { Task } from '@acorn/plugin-api/client'
import type { AgentSession } from '../../contract/wire.ts'
import {
  EmptyState, Fold, Icon, IconButton, Inline, Menu, paneCollapseKey, Row, RowActions, Rows, Section, SectionHeader,
  sidebarCollapsed, Stack, Text,
} from '@acorn/plugin-api/ui'
import { managedAgentStore } from './managedStore'
import type { AgentPaneModel } from './agentPaneModel'
import { AGENT_PANE_ID } from '../paneContribution'
import { sessionModelSummary } from '../settings/agentConfigOptions'
import ProviderGlyph, { providerMarkName } from './ProviderGlyph'
import RuntimeStateIcon, { SubagentStateIcon } from './RuntimeStateIcon'
import { attentionMark } from './stateTone'
import { subagentSummary } from './subagentDisplay'
import { canStopAgent } from './agentActivity'
import { agentSessionRoster, delegationSummary } from './sessionRoster'
import {
  compareSessions, compareSubagents, SESSION_ORDER_CHOICES, sessionOrderFor, setSessionOrder, type SessionGroup,
} from './sessionOrder'
import { isStale } from '../inlineDiff/patchStatus.ts'
import { eventTime } from './eventTime'
import {
  clearManagedSubagent, openManagedSession, selectManagedSession, selectManagedSubagent,
  selectedManagedSubagent,
} from './managedSelection'

// The Agent pane's `list` region: what is running in this task, grouped as requests that need you,
// sessions you started, sessions a workflow started, and inline diff chats.
//
// Each group is a `Rows` collection, so the arrows, Home, End, type-ahead and the selection that
// survives a refetch are the kit's and this file writes no key handling
// (docs/command-palette-and-shortcuts/focus-and-typing.md § Focus and typing). Subagents are rows of the sessions collection at depth
// one, rather than a nested list, because stepping into a child run is a selection and not an
// expansion.
//
// Workflow runs lists a workflow's sessions, not its steps. An earlier group merged this task's PTY
// sessions with its workflow steps, and opening a step spawned a terminal on the harness's resume
// command. The run pane owns a run's steps now
// (plugins/workflows runs/paneContribution.ts), and the terminal drawer owns PTY sessions, so the
// rows had two better homes and one confusing one (docs/workflows.md § What workflows refuses).

/** The order button in a group's header. The choice is this task's and this group's alone
 *  (./sessionOrder.ts). */
function OrderMenu(props: { taskId: string; group: SessionGroup; label: string }) {
  const chosen = () => sessionOrderFor(props.taskId, props.group)
  return (
    <Menu
      ariaLabel={`Order ${props.label}`}
      placement="bottom-end"
      trigger={({ open, toggle }) => (
        <IconButton icon="arrow-up-down" label={`Order ${props.label}`} opens="menu" expanded={open()} onPress={toggle} />
      )}
    >
      {(menu) => SESSION_ORDER_CHOICES.map((choice) => (
        <Menu.Item
          context={menu}
          kind="radio"
          checked={chosen() === choice.value}
          onSelect={() => setSessionOrder(props.taskId, props.group, choice.value)}
        >
          {choice.label}
        </Menu.Item>
      ))}
    </Menu>
  )
}

/** The list column's header: how many sessions this task has. Its own region, so it stays put while
 *  the list under it scrolls (docs/panes/layout.md § Layout model). */
export function AgentSidebarHeader(props: { task: Task; model: AgentPaneModel }) {
  const model = props.model
  return <SectionHeader count={model.taskSessions().length}>Agents</SectionHeader>
}

/** A session or subagent row's tooltip. `updatedAt` rather than the newest event's time: the node
 *  rebroadcasts the row only when an event changes something else on it
 *  (../../server/sessions/runtimeEngine.ts § listedRow), such as a turn ending or a subagent finishing,
 *  so a running one reads as of its last state change. */
const lastActive = (at: number) => `Last active ${eventTime(at).full}`

export default function AgentTaskSidebar(props: { task: Task; model: AgentPaneModel }) {
  const model = props.model
  // Collapsed, a row is its run state and nothing else. That glyph is already the row's leading mark
  // and already carries the queued count, so the rail says the same thing the full row's first inch
  // said: which of these is working, which is waiting on you, which is done. The title comes back as
  // the tooltip, from `title` below (client-core kit/lib/layout/collapseState.ts).
  const collapsed = sidebarCollapsed(paneCollapseKey(AGENT_PANE_ID))
  const view = startAgentView('agents.sidebar.open')
  onCleanup(view.dispose)
  void model.sessionsLoaded.then(view.ready, view.fail)

  const managedRequests = createMemo(() => model.taskSessions().flatMap((session) =>
    (managedAgentStore.snapshots()[session.id]?.requests ?? [])
      .filter((request) => request.status === 'pending' || request.status === 'resolving')
      .map((request) => ({ session, request }))))

  const attentionLoaded = new Map<string, number>()
  // The snapshots read above for their requests, held while this list is drawn, or the store's bound
  // could drop a waiting request from it (./managedStore.ts § hold).
  const attentionHeld = new Map<string, () => void>()
  onCleanup(() => {
    for (const release of attentionHeld.values()) release()
  })
  createEffect(() => {
    const waiting = new Set<string>()
    for (const session of model.taskSessions()) {
      if (['none', 'unread', 'completed', 'error'].includes(session.attention)) continue
      waiting.add(session.id)
      if (!attentionHeld.has(session.id)) attentionHeld.set(session.id, managedAgentStore.hold(session.id))
      const seq = managedAgentStore.lastEventSeq(session)
      if (attentionLoaded.get(session.id) === seq) continue
      attentionLoaded.set(session.id, seq)
      void managedAgentStore.loadSnapshot(session.id).catch(() => undefined)
    }
    // Released once it stops waiting, and read again if it starts waiting again, since by then the
    // store may have dropped it.
    for (const [id, release] of attentionHeld) {
      if (waiting.has(id)) continue
      release()
      attentionHeld.delete(id)
      attentionLoaded.delete(id)
    }
  })

  // Sessions and their subagents in one list, because they are one thing to walk with the arrows.
  // The key says which: `<session id>` or `<session id>/<subagent id>`.
  // A subagent row carries its parent session, so it lands in the same group as its parent.
  //
  // Each group builds the roster from every session sorted by that group's order and then keeps its
  // own rows, so a delegated child nests exactly as it did before there was a choice, and its
  // siblings and subagents take the group's order with it.
  const groupRows = (group: SessionGroup, keep: (session: AgentSession) => boolean) => {
    const order = sessionOrderFor(props.task.id, group)
    return agentSessionRoster(
      [...model.taskSessions()].sort(compareSessions(order)),
      managedAgentStore.delegations(),
      compareSubagents(order),
    ).filter((row) => keep(row.session)).map(({ key, label }) => ({ key, label }))
  }
  const sessionRows = createMemo(() => agentTelemetry.measure('agents.sidebar.rows', () =>
    groupRows('managed', (session) => !session.origin && session.kind !== 'workflow')))
  const workflowRows = createMemo(() => groupRows('workflow', (session) => !session.origin && session.kind === 'workflow'))
  const workflowSessionCount = createMemo(() =>
    model.taskSessions().filter((session) => !session.origin && session.kind === 'workflow').length)
  const inlineSessions = createMemo(() => model.taskSessions().filter((session) => session.origin?.kind === 'inline-diff')
    .sort(compareSessions(sessionOrderFor(props.task.id, 'inline'))))
  const inlineNeedsYou = createMemo(() => inlineSessions().filter((session) => !['none', 'unread'].includes(session.attention)).length)
  createEffect(() => agentTelemetry.observe('agents.sidebar.row_count', sessionRows().length))
  const sessionOf = (key: string) => model.sessionRoster().find((candidate) => candidate.key === key) ?? null
  const selectedRowKey = createMemo(() => {
    const sessionId = model.selectedSessionId()
    if (!sessionId) return null
    const subagentId = selectedManagedSubagent(sessionId)
    return subagentId ? `${sessionId}/${subagentId}` : sessionId
  })
  const openRow = (key: string) => {
    const found = sessionOf(key)
    if (!found) return
    if (found.kind === 'managed') {
      // Picking the session row is how you come back out of a subagent's run.
      clearManagedSubagent(found.session.id)
      openManagedSession(props.task.id, found.session.id)
      return
    }
    // The session first: a sub-row under a session that is not the open one has to bring its parent's
    // transcript up before there is a card to scroll to.
    if (found.session.id !== model.selectedSessionId()) openManagedSession(props.task.id, found.session.id)
    else selectManagedSession(props.task.id, found.session.id)
    selectManagedSubagent(found.session.id, found.subagent.id)
  }

  // One renderer for both roster sections, so a workflow session's row, subagents and actions are
  // the same as any other session's.
  const SessionRows = (rowsProps: { id: string; ariaLabel: string; items: { key: string; label: string }[] }) => (
    <Rows
      id={rowsProps.id}
      ariaLabel={rowsProps.ariaLabel}
      items={rowsProps.items}
      selected={selectedRowKey()}
      onSelect={openRow}
      onActivate={openRow}
    >
      {(item, itemProps, selected) => {
        const found = () => sessionOf(item.key)
        const session = () => found()?.session
        const subagent = () => {
          const entry = found()
          return entry?.kind === 'provider-subagent' ? entry.subagent : undefined
        }
        const managedRow = () => {
          const entry = found()
          return entry?.kind === 'managed' ? entry : undefined
        }
        return (
          <Show when={session()}>
            {(current) => (
              <Show
                when={subagent()}
                fallback={
                  <Row
                    item={itemProps}
                    variant="stacked"
                    density="compact"
                    depth={found()?.depth}
                    nested={(found()?.depth ?? 0) > 0}
                    selected={selected()}
                    title={current().title}
                    tip={lastActive(current().updatedAt)}
                    tipAt={current().updatedAt}
                    collapsed={collapsed()
                      ? <RuntimeStateIcon state={current().runtimeState} queued={current().queuedTurns} />
                      : undefined}
                    leading={<RuntimeStateIcon state={current().runtimeState} queued={current().queuedTurns} />}
                    trailing={
                      <>
                        <Show when={!['none', 'unread'].includes(current().attention)}>
                          <Icon {...attentionMark(current().attention)} />
                        </Show>
                        <RowActions ariaLabel="Session actions">
                          {(menu) => (
                            <>
                              <Show when={canStopAgent(current())}>
                                <Menu.Item context={menu} leading={<Icon name="circle-stop" />} onSelect={() => model.sessionAction(current(), 'stop')}>
                                  Stop
                                </Menu.Item>
                              </Show>
                              <Menu.Item context={menu} leading={<Icon name="pencil" />} onSelect={() => model.sessionAction(current(), 'rename')}>
                                Rename session
                              </Menu.Item>
                              <Menu.Separator />
                              <Menu.Item context={menu} tone="danger" leading={<Icon name="archive" />} onSelect={() => model.sessionAction(current(), 'archive')}>
                                Archive session…
                              </Menu.Item>
                            </>
                          )}
                        </RowActions>
                      </>
                    }
                    onPress={() => openRow(item.key)}
                  >
                    <Text emphasis="strong">{current().title}</Text>
                    <Inline gap="inline">
                        <Show when={providerMarkName(current().providerId)}>
                        {(mark) => <ProviderGlyph glyph={mark()} label={current().providerId} />}
                      </Show>
                      <Text emphasis="muted">
                        {[current().providerId, sessionModelSummary(current()), current().runtimeState]
                          .filter(Boolean).join(' · ')}
                      </Text>
                    </Inline>
                    <Show when={managedRow()}>
                      {(row) => (
                        <Show when={delegationSummary(row())}>
                          {(summary) => <Text emphasis="muted">{summary()}</Text>}
                        </Show>
                      )}
                    </Show>
                  </Row>
                }
              >
                {(child) => (
                  // The subagent roster, indented under the session that spawned it. Read straight
                  // off the session row, which the WebSocket pushes whenever an event this node
                  // records changes it, so these rows appear and settle live for every session in the task and
                  // not only the one that happens to be open. Nothing extra is fetched
                  // (docs/managed-agents.md § Subagents).
                  <Row
                    item={itemProps}
                    variant="stacked"
                    density="compact"
                    depth={found()?.depth ?? 1}
                    nested
                    selected={selected()}
                    title={child().title}
                    tip={lastActive(child().updatedAt)}
                    tipAt={child().updatedAt}
                    collapsed={collapsed() ? <SubagentStateIcon status={child().status} /> : undefined}
                    leading={<SubagentStateIcon status={child().status} />}
                    onPress={() => openRow(item.key)}
                  >
                    <Text emphasis="strong">{child().title}</Text>
                    <Text emphasis="muted">{subagentSummary(child(), sessionModelSummary(current()))}</Text>
                  </Row>
                )}
              </Show>
            )}
          </Show>
        )
      }}
    </Rows>
  )

  return (
    <Stack gap="none">
      <Show when={managedRequests().length}>
        <Section label="Needs you" count={managedRequests().length}>
          <Rows
            id={`agents:requests:${props.task.id}`}
            ariaLabel="Agent requests"
            items={managedRequests().map(({ session, request }) => ({
              key: `${session.id}:${request.providerRequestId}`,
              label: request.title,
            }))}
            onActivate={(key) => {
              const entry = managedRequests()
                .find(({ session, request }) => `${session.id}:${request.providerRequestId}` === key)
              if (entry) openManagedSession(props.task.id, entry.session.id, entry.request.providerRequestId)
            }}
          >
            {(item, itemProps) => {
              const entry = () => managedRequests()
                .find(({ session, request }) => `${session.id}:${request.providerRequestId}` === item.key)
              return (
                <Row
                  item={itemProps}
                  variant="stacked"
                  density="compact"
                  title={item.label}
                  collapsed={collapsed()
                    ? (
                      <>
                        <RuntimeStateIcon state="waiting" />
                        <Show when={entry()?.request.kind}>
                          {(kind) => <Icon {...attentionMark(kind())} />}
                        </Show>
                      </>
                    )
                    : undefined}
                  leading={<RuntimeStateIcon state="waiting" />}
                  trailing={
                    <Show when={entry()?.request.kind}>
                      {(kind) => <Icon {...attentionMark(kind())} />}
                    </Show>
                  }
                  onPress={() => {
                    const found = entry()
                    if (found) openManagedSession(props.task.id, found.session.id, found.request.providerRequestId)
                  }}
                >
                  <Text emphasis="strong">{item.label}</Text>
                  <Text emphasis="muted">{entry()?.session.title}</Text>
                </Row>
              )
            }}
          </Rows>
        </Section>
      </Show>

      <Section label="Managed sessions" actions={<OrderMenu taskId={props.task.id} group="managed" label="managed sessions" />}>
        <Show
          when={sessionRows().length}
          fallback={<EmptyState size="sm" align="start">No managed sessions</EmptyState>}
        >
          <SessionRows id={`agents:sessions:${props.task.id}`} ariaLabel="Managed sessions" items={sessionRows()} />
        </Show>
      </Section>
      <Show when={workflowRows().length}>
        <Fold label={`Workflow runs (${workflowSessionCount()})`} persistKey="agents.workflow-runs" defaultOpen
          actions={<OrderMenu taskId={props.task.id} group="workflow" label="workflow runs" />}>
          <SessionRows id={`agents:workflows:${props.task.id}`} ariaLabel="Workflow runs" items={workflowRows()} />
        </Fold>
      </Show>
      <Show when={inlineSessions().length}>
        <Fold label={`Inline chats (${inlineSessions().length})`} persistKey="agents.inline-chats"
          actions={<OrderMenu taskId={props.task.id} group="inline" label="inline chats" />}
          meta={inlineNeedsYou() ? <Text emphasis="muted">{inlineNeedsYou()} need you</Text> : undefined}>
          <Rows
            id={`agents:inline:${props.task.id}`}
            ariaLabel="Inline chats"
            items={inlineSessions().map((session) => ({ key: session.id, label: session.title }))}
            selected={selectedRowKey()}
            onSelect={(key) => openManagedSession(props.task.id, key)}
            onActivate={(key) => openManagedSession(props.task.id, key)}
          >
            {(item, itemProps, selected) => {
              const current = () => inlineSessions().find((session) => session.id === item.key)
              return <Show when={current()}>{(session) => <Row
                item={itemProps}
                variant="stacked"
                density="compact"
                selected={selected()}
                title={session().title}
                tip={lastActive(session().updatedAt)}
                tipAt={session().updatedAt}
                leading={<RuntimeStateIcon state={session().runtimeState} queued={session().queuedTurns} />}
                trailing={<Show when={!['none', 'unread'].includes(session().attention)}><Icon {...attentionMark(session().attention)} /></Show>}
                onPress={() => openManagedSession(props.task.id, session().id)}
              >
                <Text emphasis="strong">{session().title}</Text>
                <Text emphasis="muted">{session().origin?.path}:{session().origin?.line} · {session().origin && isStale(session().origin!) ? 'stale patch' : 'diff chat'}</Text>
              </Row>}</Show>
            }}
          </Rows>
        </Fold>
      </Show>
    </Stack>
  )
}
