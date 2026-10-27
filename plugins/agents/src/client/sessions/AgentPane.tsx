import { createEffect, createMemo, createResource, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import {
  clientCapability,
  featureUsable,
  formFactor,
  openPane,
  requestTerminalFocusIntent,
  setTerminalOpen,
  type Task,
} from '@acorn/plugin-api/client'
import {
  AGENT_SESSION_HEADER_POINT,
  AGENT_SESSION_POINT,
  type AgentSessionHeaderProps,
} from '@acorn/protocol/extensionPoints.ts'
import {
  Alert,
  Button,
  Card,
  Chip,
  DetailColumn,
  EmptyState,
  Field,
  Heading,
  Icon,
  IconButton,
  Inline,
  Input,
  ListDetail,
  Menu,
  Modal,
  Only,
  Picker,
  Stack,
  Text,
  Toolbar,
} from '@acorn/plugin-api/ui'
import { InlineAnnotationMarks, Slot } from '@acorn/plugin-api/ui/host'
import { registerSessionActionCommands } from '../commands'
import { WORKFLOW_CONTROL } from '../../contract/workflowControl'
import AgentConversation from './AgentConversation'
import AgentUsageIndicator from '../usage/AgentUsageIndicator'
import ProviderGlyph, { providerMarkName } from './ProviderGlyph'
import RuntimeStateIcon, { SubagentStateIcon } from './RuntimeStateIcon'
import type { AgentPaneModel } from './agentPaneModel'
import {
  choiceAccountIcon,
  choiceAvailable,
  choiceDescription,
  choiceGlyph,
  choiceLabel,
  choiceText,
  type NewSessionChoice,
} from '../../contract/newSessionChoices.ts'
import { sessionCustomAgent } from '../../shared/customAgents'
import { canStopAgent, canStopSubagent } from './agentActivity'
import { selectedManagedSubagent } from './managedSelection'
import { subagentStatusLabel } from './subagentDisplay'
import { managedAgentApi } from './managedClient'
import { agentPricingOptions } from '../pricingClient'
import { emptyAgentPricingPreferences } from '../../shared/pricing'
import { sameSessionHeaderProps, sessionHeaderContext } from './sessionHeaderContext'
import { runningBackgroundCommands } from './backgroundCommands'
import SessionSummaryModal from './SessionSummaryModal'
import { AGENT_PANE_ID } from '../../shared/paneIdentity'
import { requestSessionMarks } from './sessionMarks'
import { accountIcon, accountLabel, sessionAccount } from '../../shared/accounts'

// The Agent pane's `detail` region: the open session's header, and the conversation under it.
//
// Header, body and footer without a nested layout. The transcript inside the conversation is a
// `Timeline follow`, which owns the scroll and takes what height is left, so the bar above it and the
// composer below it are pinned by being its siblings rather than by a second set of regions
// (docs/panes/layout.md § Layout model). That is why everything here is a fragment down to the timeline.

/** The header bar: which session is open, what it is doing, and how to start another.
 *
 *  Exported for its own test: the pane around it needs a snapshot, a composer and a transcript, and
 *  the claim worth checking here is one chip. */
export function AgentDetailHeader(props: { task: Task; model: AgentPaneModel }) {
  const model = props.model
  const pricing = createQuery(() => agentPricingOptions())
  // A task terminal on one account, for what the CLI does itself, such as adding an MCP server or
  // signing in to one (docs/managed-agents/accounts.md).
  const openAccountTerminal = (taskId: string, providerId: string, name: string) =>
    model.action(async () => {
      const { terminalSessionId } = await managedAgentApi.openAccountTerminal(taskId, providerId, name)
      setTerminalOpen(taskId, true)
      requestTerminalFocusIntent(taskId, terminalSessionId)
    }, false)
  const usageAccounts = createMemo(() => {
    const accounts: Record<string, string | undefined> = Object.fromEntries(
      model.providers().map((provider) => [provider.id, provider.defaultAccount]),
    )
    const session = model.selected()
    if (session) accounts[session.providerId] = sessionAccount(session.config) ?? undefined
    return accounts
  })
  // A session a workflow started says so, and the chip opens the run that started it
  // (docs/managed-agents/sessions.md § Sessions).
  //
  // Resolved per call, never captured: a node with workflows disabled answers `undefined` here, and
  // the chip is simply absent.
  const [workflow] = createResource(
    () => (model.selected()?.kind === 'workflow' ? model.selected()?.id : undefined),
    async (sessionId) => (await clientCapability(WORKFLOW_CONTROL)?.runForSession(sessionId)) ?? null,
  )
  const runningBackground = createMemo(() => runningBackgroundCommands(model.snapshot()?.events ?? []), [], {
    equals: (left, right) => left.length === right.length && left.every((title, at) => title === right[at]),
  })
  // What the session is part of: chips on the bar, and rows of the session menu on a phone, where the
  // bar has room for one row.
  const sessionChips = (): SessionChip[] => {
    const chips: SessionChip[] = []
    const found = workflow()
    if (found)
      chips.push({
        id: 'workflow',
        icon: 'workflow',
        label: `Workflow: ${found.run.name} · ${found.step.name}`,
        press: () =>
          openPane(props.task.id, 'workflows', {
            kind: 'workflows:show-run',
            runId: found.run.id,
            stepId: found.step.id,
          }),
      })
    // Background commands outlive their turn and their card's place on screen, so the ones still
    // running stay named here (docs/managed-agents/background-commands.md).
    const count = runningBackground().length
    if (count)
      chips.push({
        id: 'background',
        icon: 'terminal',
        label: count === 1 ? '1 command running in background' : `${count} commands running in background`,
        title: runningBackground().join('\n'),
      })
    // The custom agent the session started from, by the name it had then. The snapshot is the
    // session's own, so renaming or deleting the agent later leaves this alone.
    const agent = sessionCustomAgent(model.selected()?.config ?? {})
    if (agent) chips.push({ id: 'agent', icon: 'bot', label: agent.name })
    const parent = model.selectedManagedParent()
    if (parent)
      chips.push({
        id: 'parent',
        icon: 'arrow-left',
        label: `Parent: ${parent.title}`,
        press: () => model.openManagedParent(),
      })
    return chips
  }
  const subagentId = () => {
    const session = model.selected()
    return session ? selectedManagedSubagent(session.id) : undefined
  }
  const subagent = () => model.selected()?.subagents.find((child) => child.id === subagentId())
  const canStop = () => {
    const session = model.selected()
    return !!session && (subagentId() ? canStopSubagent(session, subagent()) : canStopAgent(session))
  }
  const stop = () => {
    const session = model.selected()
    const childId = subagentId()
    if (!session) return
    void model.action(() =>
      childId ? managedAgentApi.cancelSubagent(session.id, childId) : managedAgentApi.cancel(session.id),
    )
  }
  const stateWords = () => {
    const session = model.selected()
    return subagentId() ? subagentStatusLabel(subagent()?.status) : (session?.runtimeState ?? '')
  }
  const stateIcon = (title?: string) => (
    <Show
      when={subagentId()}
      fallback={<RuntimeStateIcon state={model.selected()?.runtimeState ?? ''} title={title} />}
    >
      <SubagentStateIcon status={subagent()?.status} title={title} />
    </Show>
  )
  // A Menu, not a Picker: nobody types to find "Rename session" among a handful of actions.
  const sessionMenu = (withChips: boolean) => (
    <Menu
      ariaLabel="Session actions"
      placement="bottom-end"
      trigger={({ toggle, open }) => (
        <IconButton icon="ellipsis" label="Session actions" opens="menu" expanded={open()} onPress={toggle} />
      )}
    >
      {(menu) => (
        <>
          <Show when={withChips && sessionChips().length}>
            <For each={sessionChips()}>
              {(chip) => (
                <Show
                  when={chip.press}
                  fallback={
                    <Menu.Label>
                      <Inline>
                        <Icon name={chip.icon} />
                        {chip.label}
                      </Inline>
                    </Menu.Label>
                  }
                >
                  {(press) => (
                    <Menu.Item context={menu} title={chip.title} leading={<Icon name={chip.icon} />} onSelect={press()}>
                      {chip.label}
                    </Menu.Item>
                  )}
                </Show>
              )}
            </For>
            <Menu.Separator />
          </Show>
          <For
            each={model
              .sessionActions()
              .filter((item) => props.task.status === 'active' || READS_STORED_SESSION.has(item.id))}
          >
            {(item) => (
              <>
                {/* The one destructive action is last, below a rule
                    (docs/ui-design/interaction.md § Menus and right-click). */}
                <Show when={item.tone === 'danger'}>
                  <Menu.Separator />
                </Show>
                <Menu.Item
                  context={menu}
                  disabled={!!item.disabled}
                  tone={item.tone}
                  title={item.description}
                  leading={item.icon ? <Icon name={item.icon} /> : undefined}
                  onSelect={() => item.run()}
                >
                  {item.label}
                </Menu.Item>
              </>
            )}
          </For>
        </>
      )}
    </Menu>
  )
  return (
    <Toolbar ariaLabel="Agent session">
      {/* The provider's mark, then the title, on one line. The mark takes the title here because
          nothing beside it names the provider. */}
      <Show when={model.selected()}>
        {(session) => {
          const account = () => sessionAccount(session().config)
          const provider = () => model.providers().find((candidate) => candidate.id === session().providerId)
          const label = () => {
            const name = account()
            return name ? accountLabel(provider(), name) : undefined
          }
          const name = () => (label() ? `${session().providerId} · ${label()}` : session().providerId)
          const icon = () => accountIcon(provider(), account())
          return (
            <>
              <ProviderGlyph glyph={providerMarkName(session().providerId)} label={name()} title={name()} />
              <Show when={icon()}>{(name) => <Icon name={name()} title={label()} />}</Show>
            </>
          )
        }}
      </Show>
      <Heading level={2}>{model.selected()?.title ?? 'Agents'}</Heading>
      <Show when={model.selected()}>
        {(session) => {
          // A memo that keeps an unchanged payload, because every one it hands on is posted to the
          // plugin's worker, and the snapshot it reads is new on every streamed event.
          const header = createMemo(
            (): AgentSessionHeaderProps =>
              sessionHeaderContext(
                props.task.id,
                session(),
                model.snapshot(),
                pricing.data ?? emptyAgentPricingPreferences(),
              ),
            undefined,
            { equals: sameSessionHeaderProps },
          )
          return (
            <>
              <InlineAnnotationMarks point={AGENT_SESSION_POINT} itemKey={{ session: session().id }} />
              <Slot point={AGENT_SESSION_HEADER_POINT} taskId={props.task.id} props={header} />
            </>
          )
        }}
      </Show>
      <Only formFactors={['desktop', 'tui']}>
        <For each={sessionChips()}>
          {(chip) => (
            <Chip leading={<Icon name={chip.icon} />} title={chip.title} onPress={chip.press}>
              {chip.label}
            </Chip>
          )}
        </For>
      </Only>
      {/* Right after the title, not after the session's controls: the title truncates, so a spacer
          further along the bar never gets any width and the state and the buttons end up crowding
          the last word of it. */}
      <Toolbar.Spacer />
      <Show when={model.selected()}>
        <Only formFactors={['desktop', 'tui']}>
          <Inline>
            {stateIcon()}
            <Text emphasis="muted">{stateWords()}</Text>
          </Inline>
          {/* On the bar as well as in the menu, because a side question is for mid-turn. Not in the
              terminal, where one more button wraps the bar onto a second line. */}
          <Only formFactors={['desktop']}>
            <Show when={props.task.status === 'active'}>
              <Button size="sm" tip="Ask a side question" onPress={() => void model.askSideQuestion()}>
                btw
              </Button>
            </Show>
          </Only>
          <Button size="sm" disabled={!canStop()} onPress={stop}>
            Stop
          </Button>
          {sessionMenu(false)}
        </Only>
        {/* A phone's bar has room for one row: the state without its words, and Stop only while
            there is something to stop. */}
        <Only formFactors={['narrow']}>
          {stateIcon(stateWords())}
          <Show when={canStop()}>
            <IconButton icon="circle-stop" label="Stop" size="sm" onPress={stop} />
          </Show>
        </Only>
      </Show>
      <AgentUsageIndicator defaultAccounts={usageAccounts()} providers={model.providers()} />
      {/* An archived task has no worktree to start a session in (docs/panes/contributions.md § Contributions). */}
      <Show when={props.task.status === 'active'}>
        <Picker<NewSessionChoice>
          label={
            <>
              <Only formFactors={['desktop', 'tui']}>New</Only>
              <Only formFactors={['narrow']}>
                <Icon name="plus" />
              </Only>
            </>
          }
          ariaLabel="New session"
          size="sm"
          placement="bottom-end"
          placeholder="Filter agents…"
          emptyText={
            model.providersLoading() ? 'Checking which agents this node can run…' : 'No managed providers available.'
          }
          results={(query) =>
            model.choices().filter((item) => choiceLabel(item).toLowerCase().includes(query.trim().toLowerCase()))
          }
          leading={(item) => (
            <Inline gap="inline">
              <ProviderGlyph glyph={choiceGlyph(item)} label={choiceLabel(item)} />
              <Show when={choiceAccountIcon(item)}>
                {(icon) => <Icon name={icon()} title={accountLabel(item.provider, item.account!)} />}
              </Show>
            </Inline>
          )}
          rowLabel={choiceText}
          rowDescription={choiceDescription}
          isActive={() => false}
          isDisabled={(item) => !choiceAvailable(item) || model.creating()}
          onSelect={(item) => void model.createSession(item)}
          trailing={(item, close) => (
            <Show when={!item.agent && item.account}>
              {(account) => (
                <IconButton
                  icon="square-terminal"
                  variant="bare"
                  size="xs"
                  label={`Open a terminal on ${accountLabel(item.provider, account())}`}
                  onPress={() => {
                    close()
                    void openAccountTerminal(props.task.id, item.provider.id, account())
                  }}
                />
              )}
            </Show>
          )}
          tools={
            <IconButton
              icon="refresh-cw"
              title="Refresh provider health"
              label="Refresh provider health"
              onPress={() => void model.refreshProviders()}
            />
          }
        />
      </Show>
      {/* Last on a phone, where it also holds the chips the bar has no room for. */}
      <Only formFactors={['narrow']}>
        <Show when={model.selected()}>{sessionMenu(true)}</Show>
      </Only>
    </Toolbar>
  )
}

type SessionChip = { id: string; icon: string; label: string; title?: string; press?: () => void }

// The session actions an archived task keeps, because they only read or relabel what is stored. Fork,
// retry, compact and the terminal hand-offs all start a harness, and the task has no worktree for one.
const READS_STORED_SESSION: ReadonlySet<string> = new Set([
  'regenerate-title',
  'rename',
  'copy-id',
  'export-markdown',
  'export-json',
  'export-redacted-markdown',
  'export-redacted-json',
  'archive',
])

/** Nothing open yet: one card per harness this node can run, then one per custom agent. */
function AgentProviderCards(props: { task: Task; model: AgentPaneModel }) {
  const model = props.model
  return (
    <EmptyState
      icon={<Icon name="sparkles" tone="accent" />}
      title="Start a managed coding session"
      action={
        <Inline wrap>
          <Show when={model.providersLoading()}>
            <Text emphasis="muted">Checking which agents this node can run…</Text>
          </Show>
          <For each={model.choices()}>
            {(choice) => (
              <Card
                interactive
                disabled={!choiceAvailable(choice) || model.creating()}
                onPress={() => void model.createSession(choice)}
              >
                <Stack gap="row">
                  <Inline>
                    <ProviderGlyph glyph={choiceGlyph(choice)} label={choiceLabel(choice)} />
                    <Text emphasis="strong">{choiceText(choice)}</Text>
                    <Show when={choiceAccountIcon(choice)}>
                      {(icon) => <Icon name={icon()} title={accountLabel(choice.provider, choice.account!)} />}
                    </Show>
                  </Inline>
                  <Text emphasis="muted">
                    {!choiceAvailable(choice) || choice.agent ? choiceDescription(choice) : 'Start managed session'}
                  </Text>
                </Stack>
              </Card>
            )}
          </For>
        </Inline>
      }
    />
  )
}

/** Summary, rename and archive. Rename and archive are dialogs rather than `window.prompt` and
 *  `window.confirm`, which are unstyled in the shell and suppressed outright in a sandboxed frame. */
function AgentSessionDialogs(props: { task: Task; model: AgentPaneModel }) {
  const model = props.model
  return (
    <>
      <Show when={model.dialog()?.kind === 'summary' ? model.dialog()!.session : undefined} keyed>
        {(session) => <SessionSummaryModal session={session} onDismiss={() => model.setDialog(null)} />}
      </Show>
      <Show when={model.dialog()?.kind === 'rename'}>
        <Modal onDismiss={() => model.setDialog(null)} title="Rename session" size="sm">
          <Modal.Body>
            <Field label="Title">
              <Input
                value={model.renameText()}
                ref={(el) => queueMicrotask(() => el.focus())}
                onInput={(value) => model.setRenameText(value)}
                onSubmit={() => void model.rename()}
              />
            </Field>
          </Modal.Body>
          <Modal.Actions>
            <Button variant="ghost" onPress={() => model.setDialog(null)}>
              Cancel
            </Button>
            <Button variant="solid" onPress={() => void model.rename()}>
              Rename
            </Button>
          </Modal.Actions>
        </Modal>
      </Show>
      <Show when={model.dialog()?.kind === 'session-id' ? model.dialog()!.session : undefined}>
        {(session) => (
          <Modal onDismiss={() => model.setDialog(null)} title="Session ID" size="sm">
            <Modal.Body>
              <Field label="Select the ID and copy it with your keyboard">
                <Input value={session().id} readOnly />
              </Field>
            </Modal.Body>
            <Modal.Actions>
              <Button variant="ghost" onPress={() => model.setDialog(null)}>
                Close
              </Button>
            </Modal.Actions>
          </Modal>
        )}
      </Show>
      <Show when={model.dialog()?.kind === 'archive' ? model.dialog()!.session : undefined}>
        {(session) => (
          <Modal onDismiss={() => model.setDialog(null)} title="Archive session" size="sm" role="alertdialog">
            <Modal.Body>
              <Text wrap>
                “{session().title}” leaves this task’s list. You can still read it in Agent Center, under Archived.
              </Text>
            </Modal.Body>
            <Modal.Actions>
              <Button variant="ghost" onPress={() => model.setDialog(null)}>
                Cancel
              </Button>
              <Button variant="solid" onPress={() => void model.archive(session())}>
                Archive session
              </Button>
            </Modal.Actions>
          </Modal>
        )}
      </Show>
    </>
  )
}

export default function AgentPaneDetail(props: { task: Task; model: AgentPaneModel }) {
  const model = props.model
  const archived = () => props.task.status !== 'active'
  // The header's ••• menu, in the palette too, for as long as this region is mounted.
  // Not for an archived task: most of those actions start work, and the preview has nowhere to run it.
  if (!archived()) registerSessionActionCommands(model)
  // Other plugins' marks for the session list and this header (`requestSessionMarks`).
  createEffect(() => requestSessionMarks(model.taskSessions().map((session) => session.id)))
  // Usable once the session list has answered and the reader can see either the open session's
  // transcript, the start cards with the harnesses checked, or why it failed
  // (docs/telemetry/renderer.md § Feature openings). The host ignores every report after the first.
  createEffect(() => {
    if (model.error()) return featureUsable(AGENT_PANE_ID, 'error')
    if (!model.rosterSettled()) return
    if (model.selected()) {
      if (model.snapshot()) featureUsable(AGENT_PANE_ID, 'content')
    } else if (archived() || !model.providersLoading()) featureUsable(AGENT_PANE_ID, 'empty')
  })
  return (
    <>
      <AgentDetailHeader task={props.task} model={model} />
      <Show when={model.error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      {/* The transcript, the queue and the composer, addressed by session id alone. The run pane
          draws the same three through a capability, so a session reads the same way wherever you
          found it. This pane focuses the composer whenever the reader navigates to a session or
          returns to its task. */}
      {/* An archived task opens read-only in the archive page's preview. Its transcripts are all still
          here, but it has no worktree to start or continue a session in, so there is nothing to type
          into and no new session to offer. */}
      <Show
        when={model.selected()}
        fallback={
          // The empty state would offer a new session while the list that may hold one is still coming.
          <Show when={model.rosterSettled()} fallback={<EmptyState busy>Loading sessions…</EmptyState>}>
            {archived() ? (
              <EmptyState title="This task is archived">
                Pick a session to read it. Restore the task to start a new one.
              </EmptyState>
            ) : (
              <AgentProviderCards task={props.task} model={model} />
            )}
          </Show>
        }
      >
        {(narrowed) => {
          // Not focused while a side question is open beside it: the side one has the caret.
          const conversation = (autoFocus: boolean) => (
            <AgentConversation
              sessionId={narrowed().id}
              viewKeyPrefix="agents"
              // On a phone, focus raises the keyboard over the transcript. It rises when someone taps
              // the message box.
              autoFocus={autoFocus && !archived() && formFactor() !== 'narrow'}
              composerDisabled={archived()}
              note={archived() ? 'This task is archived. Restore it to send a message.' : undefined}
            />
          )
          // The side question in the sized first column and the session in the rest, so the session
          // keeps most of the width (docs/managed-agents/client-surfaces.md § Side questions).
          return (
            <Show when={!archived() && model.sideSession()} fallback={conversation(true)}>
              {(side) => (
                <ListDetail split listWidth="wide" widthKey="agents.side-question">
                  <DetailColumn inset>
                    <Toolbar ariaLabel="Side question">
                      <RuntimeStateIcon state={side().runtimeState} queued={side().queuedTurns} />
                      <Heading level={3}>{side().title}</Heading>
                      <Toolbar.Spacer />
                      <IconButton icon="x" label="Close side question" onPress={() => model.closeSideSession()} />
                    </Toolbar>
                    <AgentConversation sessionId={side().id} viewKeyPrefix="agents" autoFocus />
                  </DetailColumn>
                  <DetailColumn inset>{conversation(false)}</DetailColumn>
                </ListDetail>
              )}
            </Show>
          )
        }}
      </Show>
      <AgentSessionDialogs task={props.task} model={model} />
    </>
  )
}
