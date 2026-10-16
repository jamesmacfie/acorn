import { For, Show, createEffect, createSignal, on, onCleanup } from 'solid-js'
import type { BridgeWorkflowRun, BridgeWorkflowStep } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Row, SectionHeader } from '@acorn/client-core/kit/components/primitives.tsx'
import { formatRelativeTime } from '@acorn/dashboards-core/relativeTime.ts'
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

// How often a running workflow is read again. Its steps change without any hint the bridge passes on.
const LIVE_RUN_RECHECK_MS = 3_000

// Whether one of a task's runs is still going, which the Runs tab marks.
export const runsLive = (runs: readonly BridgeWorkflowRun[] | undefined): boolean =>
  Boolean(runs?.some((run) => runIsLive(run.status)))

// One task's workflow runs, as the desktop's Workflows sidebar lists them and in the kit's own rows and
// headers: the runs, newest first, then the chosen run's steps with how long each took. A step that ran
// an agent opens its conversation.
// docs/browser-extension/workflows.md.
export function Workflows(props: {
  client: BridgeClient
  nodeId: string
  taskId: string
  runs: readonly BridgeWorkflowRun[] | null
  // The run the person chose, or the newest when they haven't.
  selected: string | null
  select(runId: string): void
  refreshRuns(): void
  open(run: BridgeWorkflowRun, step: BridgeWorkflowStep): void
}) {
  const [steps, setSteps] = createSignal<BridgeWorkflowStep[] | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)
  const [now, setNow] = createSignal(Date.now())
  const run = () => props.runs?.find((each) => each.id === props.selected) ?? props.runs?.[0] ?? null

  // Hands the steps over only while their run is still the one shown.
  const loadSteps = async (runId: string) => {
    try {
      const result = await props.client.call({
        op: 'workflow.steps',
        nodeId: props.nodeId,
        taskId: props.taskId,
        runId,
      })
      if (run()?.id !== runId) return
      setProblem(null)
      setSteps(result.steps)
    } catch (error) {
      if (run()?.id === runId) setProblem(error instanceof CallFailure ? errorGuidance(error) : String(error))
    }
  }
  createEffect(
    on(
      () => run()?.id,
      (runId) => {
        setSteps(null)
        if (runId) void loadSteps(runId)
      },
    ),
  )
  createEffect(() => {
    const live = run()
    if (!live || !runIsLive(live.status)) return
    const timer = setInterval(() => {
      setNow(Date.now())
      props.refreshRuns()
      void loadSteps(live.id)
    }, LIVE_RUN_RECHECK_MS)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <div class="workflows">
      <Show when={props.runs} fallback={<p class="empty quiet">Loading runs…</p>}>
        {(runs) => (
          <Show when={runs().length} fallback={<p class="empty quiet">This task has no workflow runs.</p>}>
            <SectionHeader count={runs().length}>Runs</SectionHeader>
            <div role="list" aria-label="Runs">
              <For each={runs()}>
                {(each) => (
                  <Row
                    selected={each.id === run()?.id}
                    density="compact"
                    leading={
                      <Icon name={runGlyph(each.status)} tone={runTone(each.status)} spin={each.status === 'running'} />
                    }
                    meta={<span class="quiet">{formatRelativeTime(each.createdAt, now())}</span>}
                    onPress={() => props.select(each.id)}
                  >
                    {each.name}
                  </Row>
                )}
              </For>
            </div>
            <Show when={problem()}>
              {(message) => (
                <p class="empty problem" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <Show when={steps()} fallback={problem() ? null : <p class="empty quiet">Loading steps…</p>}>
              {(list) => (
                <>
                  <SectionHeader level="group" count={list().length}>
                    Steps
                  </SectionHeader>
                  <div role="list" aria-label="Steps">
                    <For each={list()}>
                      {(step) => (
                        // A step with no conversation, such as a gate or one not started, has nothing to open.
                        <Row
                          density="compact"
                          leading={
                            <Icon
                              name={stepGlyph(step.status)}
                              tone={stepTone(step.status)}
                              spin={step.status === 'running'}
                            />
                          }
                          meta={<span class="quiet">{stepElapsed(step, now())}</span>}
                          onPress={step.session ? () => props.open(run()!, step) : undefined}
                        >
                          {step.name}
                        </Row>
                      )}
                    </For>
                  </div>
                </>
              )}
            </Show>
          </Show>
        )}
      </Show>
    </div>
  )
}
