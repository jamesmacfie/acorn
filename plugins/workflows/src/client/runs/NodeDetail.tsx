import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate, useSearchParams } from '@solidjs/router'
import {
  clientCapability, openPane, pathForTask, refreshSessionSources, requestTerminalFocusIntent, setTerminalOpen,
  type Task, tasksOptions,
} from '@acorn/plugin-api/client'
import {
  Alert, Badge, Button, CodeBlock, EmptyState, Facts, Fold, Heading, Icon, Inline, Link, Log, Modal, Stack,
  Table, TableCell, TableHead, TableRow, Text, Textarea, Toolbar,
} from '@acorn/plugin-api/ui'
import type { WorkflowStepRow } from '../../contract/wire.ts'
import { terminalSessions } from '@acorn/plugin-terminal/contract/sessionsClient.ts'
import { AGENTS_CONVERSATION } from '@acorn/plugin-agents/contract/conversation.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { WorkflowStepProjection } from '../../shared/api'
import { gateFormProblems, type GateFormOutput, type GateFormProposal } from '../../shared/gateForm'
import type { WorkflowGateForm } from '../../shared/workflowContracts'
import TypedValueField from '../editor/TypedValueField'
import { formatCost, formatDuration, kindLabel, kindRunsAgent, stepElapsed, stepGlyph, stepTone } from './runDisplay'
import type { RunPaneModel } from './runPaneModel'
import { ChildRuns, RunLineage } from './RunRelationships'
import { RunRecords } from './RunRecords'

// The run pane's `detail` region: what one node is doing, and the controls that are legal for the
// state it is in (docs/workflows.md § Routes and UI).
//
// An agent node draws the conversation itself, through the capability plugins/agents publishes
// (@acorn/plugin-agents/contract/conversation.ts): the same transcript, queue and composer the Agent
// pane draws, because reading what a step is saying should not mean leaving the run. Every other kind
// answers "what is it doing" the way it always has.
//
// Two shapes, and the difference is not cosmetic. The conversation's timeline is the scroller and it
// sizes against the region, so that branch is a fragment with the controls folded into the toolbar;
// a `Stack` around it, or a row of buttons after it, and the composer ends up below the fold with the
// pane's own scroll broken (client-core infra/styles/shell.css, docs/panes.md § Layout model).

const readJson = <T,>(raw: string | null | undefined): T | null => {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

type AgentResult = { result?: unknown; stderrTail?: string }
type CommandResult = { durationMs?: number }
type CommandOutput = { exitCode?: number; stdout?: string; stderr?: string; truncated?: boolean }
type RunTargetOutput = { targetId?: string; sessionId?: string; url?: string | null }
type RowsOutput = { columns?: string[]; rows?: unknown[][]; rowCount?: number; truncated?: boolean; sql?: string }
type HttpOutput = { status?: number; headers?: Record<string, string>; body?: string }
type StepInputs = { prompt?: string; childTaskId?: string }

/** Which body to draw. The kind's own id, narrowed to the six shapes this pane knows how to read. */
const shapeOf = (kind: string): 'gate' | 'command' | 'run-target' | 'data' | 'http' | 'agent' | 'other' =>
  kind === 'gate-human' ? 'gate'
    : kind === 'terminal:command' ? 'command'
      : kind === 'terminal:run-target' ? 'run-target'
        : kind.startsWith('database:') ? 'data'
          : kind === 'http:request' ? 'http'
            : kindRunsAgent(kind) ? 'agent' : 'other'

const pretty = (value: unknown): string => JSON.stringify(value, null, 2)

const FAILED = new Set(['failed', 'safety-rail'])

export default function NodeDetail(props: { task: Task; model: RunPaneModel }) {
  const model = props.model
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const tasks = createQuery(() => tasksOptions(true))
  const [retrying, setRetrying] = createSignal<string | null>(null)
  const searchValue = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value

  const step = () => model.selectedStep()
  const shape = createMemo(() => shapeOf(step()?.kind ?? 'agent'))
  const inputs = createMemo(() => readJson<StepInputs>(step()?.inputsJson))
  const structured = createMemo(() => readJson<unknown>(step()?.structuredJson))
  const failed = () => FAILED.has(step()?.status ?? '')

  const childTask = createMemo(() => {
    const id = inputs()?.childTaskId
    return id ? (tasks.data ?? []).find((candidate) => candidate.id === id) : undefined
  })

  // Every unrecognised event, as JSON. The vocabulary in ../../shared/stepEvents.ts is what the
  // bodies below draw; anything else a kind sends is still worth keeping where somebody can read it.
  const otherEvents = createMemo(() => {
    const current = step()
    if (!current) return []
    return model.eventsFor(current.id).filter((event) => {
      const type = (event as { type?: unknown })?.type
      return type !== 'stdout' && type !== 'stderr' && type !== 'managed-agent'
    })
  })

  const openAgentPane = (sessionId: string): void => {
    // The seam, not the agents plugin's own function: `plugin:select` on the agents pane is what its
    // own intent listener turns into "open this session" (plugins/agents sessions/managedSelection.ts).
    openPane(props.task.id, 'agents', { kind: 'plugin:select', item: sessionId })
  }

  const openTerminal = (sessionId: string): void => {
    setTerminalOpen(props.task.id, true)
    requestTerminalFocusIntent(props.task.id, sessionId)
  }

  const openTaskTarget = (taskId: string, runId?: string, record?: { rootRunId: string; recordId: string }): void => {
    const task = (tasks.data ?? []).find((candidate) => candidate.id === taskId)
    const query = runId ? new URLSearchParams({ pane: 'workflows', item: runId }) : null
    if (query && record) {
      query.set('workflowReturnTask', props.task.id)
      query.set('workflowReturnRun', record.rootRunId)
      query.set('workflowReturnRecord', record.recordId)
    }
    const path = task ? pathForTask(task) : `/t/${encodeURIComponent(taskId)}`
    navigate(query ? `${path}?${query}` : path)
  }

  const returnToRecord = (): void => {
    const returnTask = searchValue(search.workflowReturnTask)
    const returnRun = searchValue(search.workflowReturnRun)
    const returnRecord = searchValue(search.workflowReturnRecord)
    const task = (tasks.data ?? []).find(candidate => candidate.id === returnTask)
    if (!task || !returnRun || !returnRecord) return
    const query = new URLSearchParams({ pane: 'workflows', item: returnRun, workflowRecord: returnRecord })
    navigate(`${pathForTask(task)}?${query}`)
  }
  const returnTaskAvailable = (): boolean => {
    const returnTask = searchValue(search.workflowReturnTask)
    return !!returnTask && (tasks.data ?? []).some(candidate => candidate.id === returnTask)
  }

  const resumeInTerminal = async (name: string, profileId: string | null, command: string): Promise<void> => {
    try {
      const terminal = await terminalSessions.create({
        taskId: props.task.id,
        profileId: profileId ?? 'claude-code',
        command,
        title: `⏎ ${name}`,
      })
      await refreshSessionSources()
      openTerminal(terminal.id)
    } catch (caught) {
      model.setError(caught instanceof Error ? caught.message : 'That session could not be opened in a terminal.')
    }
  }

  const submitRetry = (prompt: string | undefined): void => {
    const current = step()
    setRetrying(null)
    if (current) void model.retry(current.id, prompt)
  }

  // Resolved per call, never captured: a node with the agents plugin disabled answers `undefined` and
  // this pane keeps the summary it always drew (docs/plugins.md § Collaboration rules).
  const conversation = createMemo(() => clientCapability(AGENTS_CONVERSATION)?.Conversation)
  const drawsConversation = createMemo(() => shape() === 'agent' && !!conversation())

  // Each of these is used by both shapes, and each takes the accessor rather than the row: a snapshot
  // would stop the toolbar moving as the step's status does.
  const meta = (current: () => WorkflowStepRow) => (
    <Text emphasis="muted">
      {[kindLabel(current().kind), current().status, formatCost(current().costUsd ?? 0), stepElapsed(current(), model.now())]
        .filter(Boolean).join(' · ')}
    </Text>
  )

  const alerts = (current: () => WorkflowStepRow) => (
    <>
      <Show when={model.error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show when={current().error}>{(message) => <Alert title="This node stopped">{message()}</Alert>}</Show>
    </>
  )

  const controls = (current: () => WorkflowStepRow) => (
    <>
      <Show when={current().agentSessionId}>
        {(sessionId) => (
          <Button size="sm" disabled={model.busy()} onPress={() => openAgentPane(sessionId())}>
            {drawsConversation() ? 'Show in Agent pane' : 'Open in Agent pane'}
          </Button>
        )}
      </Show>
      {/* A step whose harness session was captured but that never became a managed session.
          The agents sidebar used to offer this and no longer does; the row still carries the
          command, and the node has already refused one whose session id is not a plain token. */}
      <Show when={!current().agentSessionId && current().resumeCommand}>
        {(command) => (
          <Button size="sm" disabled={model.busy()} onPress={() => void resumeInTerminal(current().name, current().profileId, command())}>
            Open in terminal
          </Button>
        )}
      </Show>
      <Show when={shape() === 'run-target' && (structured() as RunTargetOutput | null)?.sessionId}>
        {(sessionId) => (
          <Button size="sm" disabled={model.busy()} onPress={() => openTerminal(sessionId())}>Open terminal</Button>
        )}
      </Show>
      <Show when={current().status === 'running'}>
        <Button size="sm" tone="danger" disabled={model.busy()} onPress={() => void model.kill(current().id)}>Kill step</Button>
      </Show>
      {/* A gate with a form draws its own Approve, beside the values it approves. */}
      <Show when={current().status === 'waiting-gate' && !model.gateForm(current() as WorkflowStepProjection)}>
        <Button size="sm" variant="solid" disabled={model.busy()} onPress={() => void model.gate(true)}>Approve</Button>
        <Button size="sm" tone="danger" disabled={model.busy()} onPress={() => void model.gate(false)}>Reject</Button>
      </Show>
      <Show when={failed()}>
        <Button size="sm" variant="solid" disabled={model.busy()} onPress={() => void model.retry(current().id)}>Retry</Button>
        <Show when={shape() === 'agent'}>
          <Button size="sm" disabled={model.busy()} onPress={() => setRetrying(inputs()?.prompt ?? '')}>
            Retry with edited prompt
          </Button>
        </Show>
      </Show>
    </>
  )

  const retryModal = () => (
    <Show when={retrying() !== null}>
      <Modal onDismiss={() => setRetrying(null)} title="Retry with an edited prompt" size="md">
        <Modal.Body>
          <Textarea
            label="Prompt"
            rows={12}
            value={retrying() ?? ''}
            // Typed, because the terminal host's `Textarea` declares `ref` as `unknown`.
            ref={(el: HTMLTextAreaElement) => queueMicrotask(() => el.focus())}
            onInput={(value) => setRetrying(value)}
          />
        </Modal.Body>
        <Modal.Actions>
          <Button variant="bare" onPress={() => setRetrying(null)}>Cancel</Button>
          <Button variant="solid" onPress={() => submitRetry(retrying() ?? undefined)}>Retry</Button>
        </Modal.Actions>
      </Modal>
    </Show>
  )

  const childTaskLine = () => (
    <Show when={childTask()}>
      {(child) => (
        <Text>
          Runs on its own task. <Link onPress={() => navigate(pathForTask(child()))}>{child().title}</Link>
        </Text>
      )}
    </Show>
  )

  // What a turn sent from here actually does. The step waits on its own turn and nothing else, so a
  // turn typed now queues behind it and runs once the run has already recorded the step as done.
  const note = (current: () => WorkflowStepRow) => current().status === 'running'
    ? 'This step is still working. A turn you send now runs after it finishes, by which time the run has moved on.'
    : undefined

  // Why there is no conversation, when there is none. Only two reasons: the step has not run, or it
  // ran outside a managed session, which is what a profile with no managed driver does. Said here
  // rather than in the conversation, because the reason is this pane's to know.
  const noSession = (current: () => WorkflowStepRow) => current().status === 'pending'
    ? 'This step has not started yet.'
    : 'This step runs headless, outside a managed session, so there is no transcript. Its output is under Step details.'

  return (
    <Show when={step()} fallback={<EmptyState size="sm">Pick a node to see what it is doing.</EmptyState>}>
      {(current) => (
        <Show
          when={drawsConversation()}
          fallback={(
            <Stack gap="section">
              <Toolbar ariaLabel="Workflow node">
                <Icon
                  name={stepGlyph(current().status)}
                  tone={stepTone(current().status)}
                  spin={current().status === 'running'}
                />
                <Heading level={2}>{current().name}</Heading>
                <Toolbar.Spacer />
                {meta(current)}
              </Toolbar>

              <RunLineage run={model.selectedRun()} tasks={tasks.data ?? []} onOpen={openTaskTarget} />
              <Show when={search.workflowReturnRun && search.workflowReturnRecord}>
                <Show
                  when={returnTaskAvailable()}
                  fallback={<Text emphasis="muted">The original task is missing or archived. Its selected record history remains retained on the Node.</Text>}
                >
                  <Button size="sm" variant="bare" onPress={returnToRecord}>Back to selected record</Button>
                </Show>
              </Show>
              {alerts(current)}
              {childTaskLine()}
              <Show when={current().kind !== 'workflow-map'}>
                <ChildRuns step={current() as WorkflowStepProjection} tasks={tasks.data ?? []} onOpen={openTaskTarget} />
              </Show>

              <Switch>
                <Match when={shape() === 'gate'}>
                  <Show
                    when={model.gateForm(current() as WorkflowStepProjection)}
                    fallback={(
                      <Show
                        when={current().status === 'waiting-gate'}
                        fallback={<Text emphasis="muted">{current().status === 'done' ? 'Approved.' : `This gate is ${current().status}.`}</Text>}
                      >
                        <Text>Waiting for you.</Text>
                      </Show>
                    )}
                  >
                    {(form) => <GateFormBody step={current()} form={form()} model={model} />}
                  </Show>
                </Match>

                <Match when={shape() === 'command'}>
                  <CommandBody step={current()} model={model} />
                </Match>

                <Match when={shape() === 'run-target'}>
                  <RunTargetBody step={current()} output={structured() as RunTargetOutput | null} />
                </Match>

                <Match when={shape() === 'data'}>
                  <DataBody output={structured() as RowsOutput | null} running={current().status === 'running'} />
                </Match>

                <Match when={shape() === 'http'}>
                  <HttpBody output={structured() as HttpOutput | null} />
                </Match>

                <Match when={shape() === 'agent'}>
                  <AgentBody step={current()} structured={structured()} />
                </Match>

                <Match when={shape() === 'other'}>
                  <Show
                    when={current().kind === 'workflow-map' && model.selectedRunId()}
                    fallback={<Show when={structured()}>{(value) => <CodeBlock wrap maxHeight="block">{pretty(value())}</CodeBlock>}</Show>}
                  >
                    {(runId) => (
                      <RunRecords
                        runId={runId()}
                        stepId={current().id}
                        tasks={tasks.data ?? []}
                        initialRecordId={searchValue(search.workflowRecord)}
                        onOpen={openTaskTarget}
                      />
                    )}
                  </Show>
                </Match>
              </Switch>

              <Show when={otherEvents().length}>
                <Fold label="Events" count={otherEvents().length}>
                  <CodeBlock wrap maxHeight="block">{otherEvents().map(pretty).join('\n')}</CodeBlock>
                </Fold>
              </Show>

              <Inline wrap>{controls(current)}</Inline>
              {retryModal()}
            </Stack>
          )}
        >
          {/* The agent shape. A fragment, and the controls live in the toolbar, because the
              conversation below owns the scroll and takes the height that is left. */}
          <Toolbar ariaLabel="Workflow node">
            <Icon
              name={stepGlyph(current().status)}
              tone={stepTone(current().status)}
              spin={current().status === 'running'}
            />
            <Heading level={2}>{current().name}</Heading>
            <Toolbar.Spacer />
            {meta(current)}
            {controls(current)}
          </Toolbar>

          <RunLineage run={model.selectedRun()} tasks={tasks.data ?? []} onOpen={openTaskTarget} />
          {alerts(current)}

          {/* Folded, because the transcript below says most of it in more detail. What is worth
              keeping is the harness the step ran on, the structured value a schema step answered
              with, and whatever a handler emitted that this pane has no drawing for. */}
          <Fold label="Step details">
            <Stack gap="row">
              {childTaskLine()}
              <ChildRuns step={current() as WorkflowStepProjection} tasks={tasks.data ?? []} onOpen={openTaskTarget} />
              <Facts
                grouping="rows"
                size="sm"
                items={[
                  { label: 'Harness', value: current().profileId ?? '—' },
                  { label: 'Model', value: current().model ?? '—' },
                ]}
              />
              <Show when={structured()}>
                {(value) => <CodeBlock wrap maxHeight="block">{pretty(value())}</CodeBlock>}
              </Show>
              <Show when={otherEvents().length}>
                <CodeBlock wrap maxHeight="block">{otherEvents().map(pretty).join('\n')}</CodeBlock>
              </Show>
            </Stack>
          </Fold>

          {/* The step's own id, not just the session's: a running step has no `agentSessionId` on its
              row yet, and the agents client can find the session from the step
              (@acorn/plugin-agents/contract/conversation.ts). */}
          <Dynamic
            component={conversation()!}
            sessionId={current().agentSessionId ?? undefined}
            workflowStepId={current().id}
            viewKeyPrefix="workflows"
            note={note(current)}
            noSession={noSession(current)}
          />

          {retryModal()}
        </Show>
      )}
    </Show>
  )
}

/** A gate's form. While it waits: one field per declared field, filled with the frozen proposal,
 *  with an Edited marker and Reset on each changed one. Approve stays disabled while any value is
 *  refused, by the same check the node runs. Once answered: the approved values, edits marked. */
function GateFormBody(props: { step: WorkflowStepRow; form: WorkflowGateForm; model: RunPaneModel }) {
  const proposal = createMemo(() => readJson<Partial<GateFormProposal>>(props.step.inputsJson)?.form?.values ?? {})
  const approved = createMemo(() => readJson<GateFormOutput>(props.step.structuredJson))
  const draft = () => props.model.gateDraft(props.step.id) ?? proposal()
  const [unparsed, setUnparsed] = createSignal<ReadonlySet<string>>(new Set())
  const set = (name: string, value: DataValue | undefined): void => {
    props.model.setGateDraft(props.step.id, { ...draft(), [name]: value })
  }
  const edited = (name: string): boolean => encode(draft()[name]) !== encode(proposal()[name])
  const problems = createMemo(() => gateFormProblems(props.form, Object.fromEntries(
    Object.entries(draft()).filter(([, value]) => value !== undefined),
  )))
  const blocked = () => unparsed().size > 0 || Object.keys(problems()).length > 0
  const label = (field: WorkflowGateForm['fields'][number]) => field.label || field.name

  return (
    <Show
      when={props.step.status === 'waiting-gate'}
      fallback={(
        <Show when={approved()} fallback={<Text emphasis="muted">{`This gate is ${props.step.status}.`}</Text>}>
          {(output) => (
            <Stack gap="row">
              <Text emphasis="muted">{output().approved === 'autonomous' ? 'Approved without asking, because the run is autonomous.' : 'Approved.'}</Text>
              <Facts
                grouping="rows"
                size="sm"
                items={props.form.fields.map((field) => ({
                  label: output().edited.includes(field.name) ? `${label(field)} (edited)` : label(field),
                  value: output().values[field.name] === undefined ? '—' : display(output().values[field.name]!),
                }))}
              />
            </Stack>
          )}
        </Show>
      )}
    >
      <Stack gap="row">
        <Text>Check these values, correct any that are wrong, then approve.</Text>
        <For each={props.form.fields}>
          {(field) => (
            <Stack gap="row">
              <TypedValueField
                label={label(field)}
                schema={field.schema}
                required={field.required}
                disabled={props.model.busy()}
                value={draft()[field.name]}
                onChange={(value) => set(field.name, value)}
                onValidity={(valid) => setUnparsed((names) => {
                  const next = new Set(names)
                  if (valid) next.delete(field.name)
                  else next.add(field.name)
                  return next
                })}
              />
              <Show when={field.description}><Text emphasis="muted" wrap>{field.description}</Text></Show>
              <Show when={edited(field.name)}>
                <Inline gap="inline">
                  <Badge tone="accent" size="xs">Edited</Badge>
                  <Button size="sm" variant="bare" disabled={props.model.busy()} onPress={() => set(field.name, proposal()[field.name])}>Reset</Button>
                </Inline>
              </Show>
            </Stack>
          )}
        </For>
        <Show when={Object.keys(problems()).length}>
          <Text emphasis="muted" wrap>
            {props.form.fields.filter((field) => problems()[field.name]).map((field) => `${label(field)}: ${problems()[field.name]}`).join(' ')}
          </Text>
        </Show>
        <Inline gap="inline">
          <Button size="sm" variant="solid" disabled={props.model.busy() || blocked()} onPress={() => void props.model.gate(true, draft())}>Approve</Button>
          <Button size="sm" tone="danger" disabled={props.model.busy()} onPress={() => void props.model.gate(false)}>Reject</Button>
        </Inline>
      </Stack>
    </Show>
  )
}

const encode = (value: DataValue | undefined): string | undefined => value === undefined ? undefined : JSON.stringify(value)
const display = (value: DataValue): string => typeof value === 'string' ? value : JSON.stringify(value)

/** The provider, the model, and the last thing the agent said. */
function AgentBody(props: { step: WorkflowStepRow; structured: unknown }) {
  const result = createMemo(() => readJson<AgentResult>(props.step.resultJson))
  const said = createMemo(() => {
    const text = result()?.result
    if (typeof text === 'string' && text.trim()) return text
    return props.structured ? pretty(props.structured) : ''
  })
  return (
    <Stack gap="row">
      <Facts
        grouping="rows"
        size="sm"
        items={[
          { label: 'Harness', value: props.step.profileId ?? '—' },
          { label: 'Model', value: props.step.model ?? '—' },
        ]}
      />
      <Show
        when={said()}
        fallback={<Text emphasis="muted">{props.step.status === 'running' ? 'Working. The transcript is in the Agent pane.' : 'Nothing said yet.'}</Text>}
      >
        {(text) => (
          <Fold label="Last said" defaultOpen>
            <CodeBlock wrap maxHeight="block">{text()}</CodeBlock>
          </Fold>
        )}
      </Show>
    </Stack>
  )
}

/** The streamed tail while it runs, the exit code and the whole output once it is over. */
function CommandBody(props: { step: WorkflowStepRow; model: RunPaneModel }) {
  const output = createMemo(() => readJson<CommandOutput>(props.step.structuredJson))
  const meta = createMemo(() => readJson<CommandResult>(props.step.resultJson))
  const tail = createMemo(() => props.model.tailFor(props.step.id))
  return (
    <Stack gap="row">
      <Show when={output()}>
        {(done) => (
          <Facts
            grouping="rows"
            size="sm"
            items={[
              { label: 'Exit code', value: String(done().exitCode ?? '—') },
              { label: 'Took', value: formatDuration(meta()?.durationMs ?? 0) },
              ...(done().truncated ? [{ label: 'Output', value: 'cut short' }] : []),
            ]}
          />
        )}
      </Show>
      <Show when={props.step.status === 'running' && tail().length}>
        <Log lines={tail()} follow ariaLabel="Command output" />
      </Show>
      <Show when={output()?.stdout || output()?.stderr}>
        <Fold label="Output">
          <CodeBlock wrap maxHeight="block">{[output()?.stdout, output()?.stderr].filter(Boolean).join('\n')}</CodeBlock>
        </Fold>
      </Show>
    </Stack>
  )
}

/** Where the target is serving, once it says. */
function RunTargetBody(props: { step: WorkflowStepRow; output: RunTargetOutput | null }) {
  return (
    <Show
      when={props.output?.url}
      fallback={<Text emphasis="muted">{props.step.status === 'running' ? 'Starting…' : 'This target reported no URL.'}</Text>}
    >
      {(url) => <Facts grouping="rows" size="sm" items={[{ label: 'URL', value: url(), mono: true }]} />}
    </Show>
  )
}

/** The rows a query answered with, and the SQL behind them. */
function DataBody(props: { output: RowsOutput | null; running: boolean }) {
  const columns = () => props.output?.columns ?? []
  const rows = () => props.output?.rows ?? []
  return (
    <Show when={props.output} fallback={<Text emphasis="muted">{props.running ? 'Reading…' : 'No rows.'}</Text>}>
      <Stack gap="row">
        <Text emphasis="muted">
          {`${props.output?.rowCount ?? rows().length} rows${props.output?.truncated ? ' (cut short)' : ''}`}
        </Text>
        <Show when={props.output?.sql}>{(sql) => <CodeBlock wrap>{sql()}</CodeBlock>}</Show>
        <Show when={rows().length}>
          <Table size="sm" stickyHead>
            <TableRow head>
              <For each={columns()}>{(column) => <TableHead>{column}</TableHead>}</For>
            </TableRow>
            <For each={rows()}>
              {(row) => (
                <TableRow>
                  <For each={row}>{(cell) => <TableCell>{cell === null ? '—' : String(cell)}</TableCell>}</For>
                </TableRow>
              )}
            </For>
          </Table>
        </Show>
      </Stack>
    </Show>
  )
}

/** The response, with its headers folded away. */
function HttpBody(props: { output: HttpOutput | null }) {
  return (
    <Show when={props.output} fallback={<Text emphasis="muted">Sending…</Text>}>
      {(output) => (
        <Stack gap="row">
          <Facts grouping="rows" size="sm" items={[{ label: 'Status', value: String(output().status ?? '—') }]} />
          <Show when={output().headers}>
            {(headers) => (
              <Fold label="Headers">
                <CodeBlock wrap maxHeight="block">{Object.entries(headers()).map(([name, value]) => `${name}: ${value}`).join('\n')}</CodeBlock>
              </Fold>
            )}
          </Show>
          <Show when={output().body}>{(body) => <CodeBlock wrap maxHeight="block">{body()}</CodeBlock>}</Show>
        </Stack>
      )}
    </Show>
  )
}
