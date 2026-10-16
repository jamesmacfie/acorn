import { For, Show, createEffect, createSignal, on, onCleanup } from 'solid-js'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { BridgeWorkflow, BridgeWorkflowRun, BridgeWorkflowStep } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Text } from '@acorn/client-core/kit/components/content'
import { Section } from '@acorn/client-core/kit/components/layout'
import { Card, EmptyState, Row } from '@acorn/client-core/kit/components/primitives.tsx'
import { formatRelativeTime } from '@acorn/dashboards-core/relativeTime.ts'
import { collectItemWorkflowInputs, itemWorkflowInputsReady } from '@acorn/plugin-workflows/contract/itemInputs.ts'
import {
  runGlyph,
  runIsLive,
  runTone,
  stepElapsed,
  stepGlyph,
  stepTone,
} from '@acorn/plugin-workflows/contract/statusDisplay.ts'
import { CallFailure } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'
import { WorkflowForm, WorkflowPicker, inputText, workflowStarter } from './WorkflowForm'

// How often an open, running run is read again. Its steps change without any hint the bridge passes on.
const LIVE_RUN_RECHECK_MS = 3_000

// Whether one of a task's runs is still going, which the Runs tab marks.
export const runsLive = (runs: readonly BridgeWorkflowRun[] | undefined): boolean =>
  Boolean(runs?.some((run) => runIsLive(run.status)))

const failure = (error: unknown) => (error instanceof CallFailure ? errorGuidance(error) : String(error))

// One task's workflow runs, newest first, each opening to its steps under it. A step that ran an agent
// opens its conversation. Run workflow starts a run in the task: at once when every input has a value,
// or after the workflow's form. docs/browser-extension/workflows.md.
export function Runs(props: {
  client: BridgeClient
  nodeId: string
  taskId: string
  online: boolean
  // The task's project, whose workflows Run workflow lists.
  project: { id: string; name: string } | null
  runs: readonly BridgeWorkflowRun[] | null
  // Which runs the person opened or closed, by ID. A run they haven't touched is open when it's the
  // newest. Workspace holds it, so it lasts while the panel is open.
  folds: Record<string, boolean>
  fold(runId: string, open: boolean): void
  // A run started here: open it alone, and read the runs again.
  started(runId: string): void
  refreshRuns(): void
  open(run: BridgeWorkflowRun, step: BridgeWorkflowStep): void
}) {
  const [problem, setProblem] = createSignal<string | null>(null)
  const isOpen = (run: BridgeWorkflowRun, index: number) => props.folds[run.id] ?? index === 0

  // The clock that ages the rows and paces the reads, ticking while an open run still changes.
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!props.runs?.some((run, index) => isOpen(run, index) && runIsLive(run.status))) return
    const timer = setInterval(() => {
      setNow(Date.now())
      props.refreshRuns()
    }, LIVE_RUN_RECHECK_MS)
    onCleanup(() => clearInterval(timer))
  })

  const [workflows, setWorkflows] = createSignal<BridgeWorkflow[] | null>(null)
  // Read up front, so Run workflow's picker opens on the list. The project is unknown until the Node's
  // task list names the task.
  createEffect(
    on(
      () => props.project?.id,
      async (projectId) => {
        if (!projectId) return
        try {
          const result = await props.client.call({ op: 'workflows.list', nodeId: props.nodeId, projectId })
          setWorkflows(result.workflows)
        } catch (error) {
          setProblem(failure(error))
        }
      },
    ),
  )

  // The workflow whose form shows, what the person typed into it, and whether a start is under way.
  const [workflowId, setWorkflowId] = createSignal('')
  const [values, setValues] = createSignal<Record<string, string>>({})
  const [starting, setStarting] = createSignal(false)
  const workflow = () => workflows()?.find((each) => each.id === workflowId()) ?? null
  // An input starts from its default. No item fills it here.
  const valueIn = (chosen: BridgeWorkflow) => (name: string) =>
    inputText(values()[name] ?? chosen.inputs.find((input) => input.name === name)?.default)
  const closeForm = () => {
    setWorkflowId('')
    setValues({})
  }

  const startRun = workflowStarter(props.client, props.nodeId, setProblem)
  const start = async (chosen: BridgeWorkflow) => {
    if (starting()) return
    let inputs: Record<string, DataValue>
    try {
      inputs = collectItemWorkflowInputs(chosen.inputs, valueIn(chosen))
    } catch (error) {
      setProblem(`Check the workflow's inputs: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    setStarting(true)
    setProblem(null)
    const runId = await startRun(props.taskId, chosen.id, inputs)
    setStarting(false)
    if (!runId) return
    closeForm()
    props.started(runId)
  }
  // A workflow with an input that has no value asks for it first.
  const pick = (id: string) => {
    const chosen = workflows()?.find((each) => each.id === id)
    if (!chosen) return
    setValues({})
    if (chosen.inputs.every((input) => input.default !== undefined)) {
      setWorkflowId('')
      void start(chosen)
    } else setWorkflowId(id)
  }

  const runPicker = (solid = false) => (
    <WorkflowPicker
      label={
        <>
          <Icon name="play" />
          <span>Run workflow</span>
        </>
      }
      name="Run workflow"
      workflows={workflows()}
      project={props.project?.name ?? ''}
      disabled={!props.online || starting()}
      placement={solid ? undefined : 'bottom-end'}
      pick={pick}
    />
  )

  return (
    <div class="runs">
      <Show when={props.runs} fallback={<p class="empty quiet">Loading runs…</p>}>
        {(runs) => (
          <Show
            when={runs().length || workflow()}
            fallback={
              <EmptyState
                icon={<Icon name="workflow" size="2em" tone="muted" />}
                title="No runs in this task"
                action={runPicker(true)}
              />
            }
          >
            <Section label="Runs" count={runs().length} actions={runPicker()}>
              <Show when={workflow()}>
                {(chosen) => (
                  <div class="run-form">
                    <Card pad="sm">
                      <WorkflowForm
                        workflow={chosen()}
                        workflows={workflows()}
                        project={props.project?.name ?? ''}
                        valueOf={valueIn(chosen())}
                        edit={(name, value) => setValues((typed) => ({ ...typed, [name]: value }))}
                        choose={(id) => {
                          setWorkflowId(id)
                          setValues({})
                        }}
                        ready={itemWorkflowInputsReady(chosen().id, chosen().inputs, valueIn(chosen()))}
                        busy={starting()}
                        disabled={!props.online}
                        start={() => void start(chosen())}
                        cancel={closeForm}
                      />
                    </Card>
                  </div>
                )}
              </Show>
              <ul aria-label="Runs">
                <For each={runs()}>
                  {(run, index) => (
                    <RunItem
                      client={props.client}
                      nodeId={props.nodeId}
                      taskId={props.taskId}
                      run={run}
                      open={isOpen(run, index())}
                      now={now()}
                      toggle={() => props.fold(run.id, !isOpen(run, index()))}
                      openStep={(step) => props.open(run, step)}
                    />
                  )}
                </For>
              </ul>
            </Section>
          </Show>
        )}
      </Show>
      <Show when={problem()}>
        {(message) => (
          <p class="empty problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </div>
  )
}

// A run's row, and while it's open its steps under it, behind the kit's ownership rule.
function RunItem(props: {
  client: BridgeClient
  nodeId: string
  taskId: string
  run: BridgeWorkflowRun
  open: boolean
  now: number
  toggle(): void
  openStep(step: BridgeWorkflowStep): void
}) {
  return (
    <li>
      <Row
        density="compact"
        selected={props.open}
        expanded={props.open}
        leading={
          <Icon
            name={runGlyph(props.run.status)}
            tone={runTone(props.run.status)}
            spin={props.run.status === 'running'}
          />
        }
        meta={<span class="quiet">{formatRelativeTime(props.run.createdAt, props.now)}</span>}
        trailing={<Icon name={props.open ? 'chevron-up' : 'chevron-down'} tone="muted" />}
        onPress={props.toggle}
      >
        {props.run.name}
      </Row>
      <Show when={props.open}>
        <RunSteps {...props} />
      </Show>
    </li>
  )
}

// An open run's steps, read when it opens and whenever the run's state changes, and on each tick of
// the clock while the run still goes.
function RunSteps(props: {
  client: BridgeClient
  nodeId: string
  taskId: string
  run: BridgeWorkflowRun
  now: number
  openStep(step: BridgeWorkflowStep): void
}) {
  const [steps, setSteps] = createSignal<BridgeWorkflowStep[] | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)
  const load = async () => {
    try {
      const result = await props.client.call({
        op: 'workflow.steps',
        nodeId: props.nodeId,
        taskId: props.taskId,
        runId: props.run.id,
      })
      setProblem(null)
      setSteps(result.steps)
    } catch (error) {
      setProblem(failure(error))
    }
  }
  createEffect(
    on(
      () => props.run.status,
      () => void load(),
    ),
  )
  createEffect(
    on(
      () => props.now,
      () => runIsLive(props.run.status) && void load(),
      { defer: true },
    ),
  )

  return (
    <>
      <Show when={problem()}>
        {(message) => (
          <p class="empty problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={steps()} fallback={problem() ? null : <p class="empty quiet">Loading steps…</p>}>
        {(list) => (
          <ul aria-label={`Steps of ${props.run.name}`}>
            <For each={list()}>
              {(step) => (
                <li>
                  {/* A step with no conversation, such as a gate or one not started, has nothing to open. */}
                  <Row
                    nested
                    density="compact"
                    leading={
                      <Icon
                        name={stepGlyph(step.status)}
                        tone={stepTone(step.status)}
                        spin={step.status === 'running'}
                      />
                    }
                    meta={<span class="quiet">{stepElapsed(step, props.now)}</span>}
                    trailing={step.session ? <Icon name="chevron-right" tone="muted" /> : undefined}
                    onPress={step.session ? () => props.openStep(step) : undefined}
                  >
                    {step.session ? step.name : <Text emphasis="muted">{step.name}</Text>}
                  </Row>
                </li>
              )}
            </For>
          </ul>
        )}
      </Show>
    </>
  )
}
