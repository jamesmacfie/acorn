import { createResource, For, Show } from 'solid-js'
import { clientCapability, openPane, type Task } from '@acorn/plugin-api/client'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import {
  Alert, Button, Card, Chip, EmptyState, Field, Heading, Icon, Inline, Input, Menu, Modal, Picker,
  Stack, Text, Toolbar,
} from '@acorn/plugin-api/ui'
import { WORKFLOW_CONTROL } from '../../contract/workflowControl'
import AgentTranscript from './AgentTranscript'
import AgentComposer from '../composer/AgentComposer'
import AgentUsageIndicator from '../usage/AgentUsageIndicator'
import ProviderGlyph, { providerMarkName } from './ProviderGlyph'
import QueuedAgentTurns from '../composer/QueuedAgentTurns'
import RuntimeStateIcon from './RuntimeStateIcon'
import type { AgentPaneModel } from './agentPaneModel'
import { canStopAgent } from './agentActivity'
import { agentSessionIsStarting } from '../composer/agentComposerState'
import { managedAgentApi } from './managedClient'
import { managedAgentStore } from './managedStore'
import { clearManagedSubagent, focusedManagedRequest, selectedManagedSubagent } from './managedSelection'

// The Agent pane's `detail` region: the open session's header, its transcript, and the composer.
//
// Header, body and footer without a nested layout. The transcript is a `Timeline follow`, which owns
// the scroll and takes what height is left, so the bar above it and the composer below it are pinned
// by being its siblings rather than by a second set of regions (docs/panes.md § Layout model).

/** The header bar: which session is open, what it is doing, and how to start another.
 *
 *  Exported for its own test: the pane around it needs a snapshot, a composer and a transcript, and
 *  the claim worth checking here is one chip. */
export function AgentDetailHeader(props: { task: Task; model: AgentPaneModel }) {
  const model = props.model
  // A session a workflow started says so, and the chip opens the run that started it. The session row
  // has carried `kind` and `workflowRunId` since the runtime wrote them; nothing read either until
  // the run pane existed to open (docs/managed-agents.md § Sessions).
  //
  // Resolved per call, never captured: a node with workflows disabled answers `undefined` here, and
  // the chip is simply absent.
  const [workflow] = createResource(
    () => (model.selected()?.kind === 'workflow' ? model.selected()?.id : undefined),
    async (sessionId) => (await clientCapability(WORKFLOW_CONTROL)?.runForSession(sessionId)) ?? null,
  )
  return (
    <Toolbar ariaLabel="Agent session">
      {/* The provider's mark, then the title, on one line. It used to be a "CLAUDE" eyebrow stacked
          over the title, which made the bar two lines tall for a fact the mark carries in one
          glyph. The mark takes the title here because nothing beside it names the provider. */}
      <Show when={model.selected()?.providerId}>
        {(providerId) => (
          <ProviderGlyph glyph={providerMarkName(providerId())} label={providerId()} title={providerId()} />
        )}
      </Show>
      <Heading level={2}>{model.selected()?.title ?? 'Agents'}</Heading>
      <Show when={workflow()}>
        {(found) => (
          <Chip
            leading={<Icon name="workflow" />}
            onPress={() => openPane(props.task.id, 'workflows', {
              kind: 'workflows:show-run',
              runId: found().run.id,
              stepId: found().step.id,
            })}
          >
            {`Workflow: ${found().run.name} · ${found().step.name}`}
          </Chip>
        )}
      </Show>
      {/* Right after the title, not after the session's controls: the title truncates, so a spacer
          further along the bar never gets any width and the state and the buttons end up crowding
          the last word of it. */}
      <Toolbar.Spacer />
      <Show when={model.selected()}>
        {(narrowed) => {
          const session = narrowed
          return (
          <>
            <Inline>
              <RuntimeStateIcon state={session().runtimeState} />
              <Text emphasis="muted">{session().runtimeState}</Text>
            </Inline>
            <Button
              size="sm"
              disabled={!canStopAgent(session())}
              onPress={() => void model.action(() => managedAgentApi.cancel(session().id))}
            >
              Stop
            </Button>
            {/* Was a Picker — a filter input over five or six actions, which is the wrong
                affordance: nobody types to find "Rename session". A Menu is the shape. */}
            <Menu
              ariaLabel="Session actions"
              placement="bottom-end"
              trigger={({ toggle, open }) => (
                <Button
                  size="sm"
                  iconOnly
                  label="Session actions"
                  opens="menu"
                  expanded={open()}
                  onPress={toggle}
                >
                  <Icon name="ellipsis" />
                </Button>
              )}
            >
              {(menu) => (
                <For each={model.sessionActions()}>
                  {(item) => (
                    <Menu.Item
                      context={menu}
                      disabled={!!item.disabled}
                      title={item.description}
                      onSelect={() => item.run()}
                    >
                      {item.label}
                    </Menu.Item>
                  )}
                </For>
              )}
            </Menu>
          </>
        )}}
      </Show>
      <AgentUsageIndicator />
      <Picker<AgentProviderDescriptor>
        label="New"
        ariaLabel="New session"
        size="sm"
        placement="bottom-end"
        placeholder="Filter providers…"
        emptyText="No managed providers available."
        results={(query) => model.providers().filter((item) =>
          item.label.toLowerCase().includes(query.trim().toLowerCase()))}
        leading={(item) => <ProviderGlyph glyph={item.glyph} label={item.label} />}
        rowLabel={(item) => item.label}
        rowDescription={(item) =>
          item.installed ? item.executableVersion ?? 'Available' : item.diagnostics[0] ?? 'Not installed'}
        isActive={() => false}
        isDisabled={(item) => !item.installed || model.creating()}
        onSelect={(item) => void model.createSession(item)}
        tools={
          <Button
            variant="bare"
            iconOnly
            title="Refresh provider health"
            label="Refresh provider health"
            onPress={() => void model.refreshProviders()}
          >
            <Icon name="refresh-cw" />
          </Button>
        }
      />
    </Toolbar>
  )
}

/** Nothing open yet: one card per harness this node can run. */
function AgentProviderCards(props: { task: Task; model: AgentPaneModel }) {
  const model = props.model
  return (
    <EmptyState
      icon={<Icon name="sparkles" tone="accent" />}
      title="Start a managed coding session"
      action={
        <Inline wrap>
          <For each={model.providers()}>
            {(provider) => (
              <Card
                interactive
                disabled={!provider.installed || model.creating()}
                onPress={() => void model.createSession(provider)}
              >
                <Stack gap="row">
                  <Inline>
                    <ProviderGlyph glyph={provider.glyph} label={provider.label} />
                    <Text emphasis="strong">{provider.label}</Text>
                  </Inline>
                  <Text emphasis="muted">
                    {provider.installed ? 'Start managed session' : provider.diagnostics[0] ?? 'Unavailable'}
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

/** Rename and archive. Both are dialogs rather than `window.prompt` and `window.confirm`, which are
 *  unstyled in the shell and suppressed outright in a sandboxed frame. */
function AgentSessionDialogs(props: { task: Task; model: AgentPaneModel }) {
  const model = props.model
  return (
    <>
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
            <Button variant="bare" onPress={() => model.setDialog(null)}>Cancel</Button>
            <Button variant="solid" onPress={() => void model.rename()}>Rename</Button>
          </Modal.Actions>
        </Modal>
      </Show>
      <Show when={model.dialog()?.kind === 'archive' ? model.dialog()!.session : undefined}>
        {(session) => (
          <Modal onDismiss={() => model.setDialog(null)} title="Archive session" size="sm" role="alertdialog">
            <Modal.Body>
              <Text wrap>
                Archive “{session().title}”? It leaves this task’s list and stays readable under the
                archived filter in Agent Center.
              </Text>
            </Modal.Body>
            <Modal.Actions>
              <Button variant="bare" onPress={() => model.setDialog(null)}>Cancel</Button>
              <Button variant="solid" onPress={() => void model.archive(session())}>Archive</Button>
            </Modal.Actions>
          </Modal>
        )}
      </Show>
    </>
  )
}

export default function AgentPaneDetail(props: { task: Task; model: AgentPaneModel }) {
  const model = props.model
  return (
    <>
      <AgentDetailHeader task={props.task} model={model} />
      <Show when={model.error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show when={model.selected()} fallback={<AgentProviderCards task={props.task} model={model} />}>
        {(narrowed) => {
          const session = narrowed
          return (
          <>
            <Show
              when={model.snapshot()}
              fallback={
                <EmptyState busy>
                  {agentSessionIsStarting(session()) ? 'Connecting…' : 'Loading conversation…'}
                </EmptyState>
              }
            >
              {(narrowedSnapshot) => {
                const snapshot = narrowedSnapshot
                return (
                <>
                  <AgentTranscript
                    taskId={props.task.id}
                    snapshot={snapshot()}
                    focusRequestId={focusedManagedRequest(session().id)}
                    focusSubagentId={selectedManagedSubagent(session().id)}
                    onExitSubagent={() => clearManagedSubagent(session().id)}
                    onRequestResolved={() => void managedAgentStore.loadSnapshot(session().id)}
                  />
                  <QueuedAgentTurns
                    sessionId={session().id}
                    runtimeState={snapshot().session.runtimeState}
                    turns={snapshot().turns}
                    onChanged={() => managedAgentStore.loadSnapshot(session().id)}
                    onError={model.setError}
                  />
                </>
                )
              }}
            </Show>
            {/* Gone while a subagent's run owns the window. The composer only ever addresses the
                session, so leaving it under a subagent's transcript would read as "reply to this
                subagent", which is not a thing either harness offers. The draft survives: it lives in
                a module signal keyed by session (managedDrafts.ts) plus localStorage, not in the
                component, so stepping into a subagent and back leaves half-typed text alone. */}
            <Show when={!selectedManagedSubagent(session().id)}>
              <AgentComposer
                session={session()}
                disabled={session().controller !== 'acorn' || session().runtimeState === 'archived'}
                submitDisabled={agentSessionIsStarting(session())}
                previousAutomaticContext={model.previousAutomaticContext()}
                onSessionUpdated={managedAgentStore.upsertSession}
                onSent={() => void managedAgentStore.loadSnapshot(session().id)}
              />
            </Show>
          </>
          )
        }}
      </Show>
      <AgentSessionDialogs task={props.task} model={model} />
    </>
  )
}
