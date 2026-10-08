import { createMemo, Show } from 'solid-js'
import { Facts, Fold, Stack, Text } from '@acorn/plugin-api/ui'
import type { AgentExecuteGoalStatus, AgentExecuteGoalSummary } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import type { WorkflowStepRow } from '../../contract/wire.ts'

// An agent step's completion condition in the run pane (docs/workflows/agent-steps.md § Completion
// conditions): what it asks for, where its checks stand, and why it stopped. Read-only, because the
// run's own Stop and Retry are the controls. Open by default once the step ended without it, so the
// person retrying sees the unfinished condition first.

const STATUS: Record<AgentExecuteGoalStatus, string> = {
  checking: 'Checking completion',
  continuing: 'Continuing toward goal',
  satisfied: 'Met',
  blocked: 'Not met',
  exhausted: 'Limit reached',
  unavailable: 'Could not check',
  stopped: 'Stopped',
}

const read = <T,>(raw: string | null | undefined): T | null => {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const turns = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

export default function GoalDetails(props: { step: WorkflowStepRow }) {
  const summary = createMemo(() => read<AgentExecuteGoalSummary>(props.step.goalJson))
  // The condition is frozen with the attempt's inputs before its first turn, so it shows before any check.
  const objective = createMemo(() => summary()?.objective ?? read<{ goal?: string }>(props.step.inputsJson)?.goal)
  const status = () => {
    const current = summary()?.status
    if (current) return STATUS[current]
    return props.step.status === 'running' ? 'Waiting for the first turn' : 'Not checked'
  }
  const unfinished = () => !!summary() && !['checking', 'continuing', 'satisfied'].includes(summary()!.status)
  return (
    <Show when={objective()}>
      {(text) => (
        <Fold label={`Completion condition: ${status()}`} defaultOpen={unfinished()}>
          <Stack gap="row">
            <Text wrap>{text()}</Text>
            <Show when={summary()}>
              {(goal) => (
                <Facts
                  grouping="rows"
                  size="sm"
                  items={[
                    { label: 'Status', value: status() },
                    { label: 'Automatic turns', value: `${turns(goal().continuations, 'goal continuation', 'goal continuations')}, ${turns(goal().repairs, 'result repair', 'result repairs')}` },
                  ]}
                />
              )}
            </Show>
            <Show when={summary()?.reason ?? summary()?.verdict?.reason}>
              {(reason) => <Text wrap>{`Last check: ${reason()}`}</Text>}
            </Show>
            <Show when={summary()?.verdict?.evidence_summary}>
              {(evidence) => <Text wrap emphasis="muted">{`Evidence: ${evidence()}`}</Text>}
            </Show>
          </Stack>
        </Fold>
      )}
    </Show>
  )
}
