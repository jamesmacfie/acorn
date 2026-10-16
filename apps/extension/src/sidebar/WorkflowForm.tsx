import { For, type JSX } from 'solid-js'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { BridgeWorkflow } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import Picker, { type PickerProps } from '@acorn/client-core/kit/components/inputs/Picker.tsx'
import { Button, Field, Textarea } from '@acorn/client-core/kit/components/primitives.tsx'
import { CallFailure, isUncertain } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'

// Starting a workflow run from the panel, shared by This page's handoff card and a task's Runs tab: the
// workflow picker, the inputs form, and the start itself. docs/browser-extension/workflows.md.

// A value as an input's text box shows it.
export const inputText = (value: DataValue | undefined): string =>
  value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)

// A project's workflows, grouped under the project's name. Workflow definitions carry no description,
// so a row is the workflow's name.
export function WorkflowPicker(props: {
  label: string | JSX.Element
  // The accessible name, which `pnpm dev:extension:ui pick` and the tests find it by.
  name: string
  workflows: readonly BridgeWorkflow[] | null
  project: string
  chosen?: string
  disabled?: boolean
  placement?: PickerProps<never>['placement']
  pick(workflowId: string): void
}) {
  return (
    <Picker
      label={props.label}
      ariaLabel={props.name}
      size="sm"
      disabled={props.disabled}
      placement={props.placement}
      placeholder="Filter workflows"
      emptyText={props.workflows ? 'This project has no workflow to run. Publish one in Acorn.' : 'Loading workflows…'}
      items={(props.workflows ?? []).map((workflow) => ({
        id: workflow.id,
        label: workflow.name,
        group: props.project,
        active: workflow.id === props.chosen,
      }))}
      onPick={props.pick}
    />
  )
}

// The chosen workflow's inputs as fields, under a picker that changes the workflow, with Start run and
// Cancel. The caller owns the values, so it decides what an input starts from.
export function WorkflowForm(props: {
  workflow: BridgeWorkflow
  workflows: readonly BridgeWorkflow[] | null
  project: string
  valueOf(name: string): string
  edit(name: string, value: string): void
  choose(workflowId: string): void
  ready: boolean
  busy: boolean
  // Start run is off, such as while the Node is offline.
  disabled: boolean
  start(): void
  cancel(): void
}) {
  return (
    <>
      <Field label="Workflow" layout="row">
        <WorkflowPicker
          label={props.workflow.name}
          name="Workflow"
          workflows={props.workflows}
          project={props.project}
          chosen={props.workflow.id}
          pick={props.choose}
        />
      </Field>
      <For each={props.workflow.inputs}>
        {(input) => (
          <Field label={input.label ?? input.name} required={input.required}>
            <Textarea
              name={`input-${input.name}`}
              rows={2}
              required={input.required}
              placeholder={input.description}
              value={props.valueOf(input.name)}
              onInput={(value) => props.edit(input.name, value)}
            />
          </Field>
        )}
      </For>
      <div class="row">
        <Button
          size="sm"
          variant="solid"
          tone="accent"
          busy={props.busy}
          disabled={props.disabled || !props.ready}
          onPress={props.start}
        >
          <Icon name="play" />
          Start run
        </Button>
        <Button size="sm" variant="ghost" disabled={props.busy} onPress={props.cancel}>
          Cancel
        </Button>
      </div>
    </>
  )
}

// Starts runs with `workflow.start`. A start that failed keeps its key while the same task, workflow,
// and inputs are asked again, so a second press after a lost reply starts no second run. A confirmed
// start lets the key go, so the person can run the same workflow again on purpose. Each call answers
// the run's ID, or null after `report` says why there's no run.
export function workflowStarter(client: BridgeClient, nodeId: string, report: (message: string) => void) {
  let unconfirmed: { key: string; asked: string } | null = null
  return async (taskId: string, workflowId: string, inputs: Record<string, DataValue>): Promise<string | null> => {
    const asked = JSON.stringify([taskId, workflowId, inputs])
    const key = unconfirmed?.asked === asked ? unconfirmed.key : crypto.randomUUID()
    unconfirmed = { key, asked }
    try {
      const result = await client.call({
        op: 'workflow.start',
        nodeId,
        taskId,
        defId: workflowId,
        ...(Object.keys(inputs).length ? { inputs } : {}),
        key,
      })
      unconfirmed = null
      return result.runId
    } catch (error) {
      if (error instanceof CallFailure && isUncertain(error.code))
        report("The Node didn't confirm the run. Start it again to retry; the Node won't start a second one.")
      else report(error instanceof CallFailure ? errorGuidance(error) : String(error))
      return null
    }
  }
}
