import { For, Show } from 'solid-js'
import { Field, SegmentedControl, Select, Stack } from '@acorn/plugin-api/ui'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import type { WorkflowCatalog, WorkflowStepDef } from '../../shared/workflowContracts'

// The fields every agent-running kind takes, whoever contributed it: the harness, whatever options
// that harness advertises, where it runs, and what it does with its upstreams
// (docs/workflows.md § Authoring).
//
// They are not in any kind's `describe`, on purpose. A plugin contributing a kind that runs an agent
// should not have to restate the model list, and the model list is not the plugin's to state: each
// provider advertises its own options and the editor reads them from
// `GET /v2/p/agents/providers`, the same list the agent pane offers.

const OPTION_ORDER: Record<string, number> = { model: 0, reasoning: 1, mode: 2, permission: 3, other: 4 }

export default function AgentNodeForm(props: {
  step: WorkflowStepDef
  catalog: WorkflowCatalog | undefined
  providers: readonly AgentProviderDescriptor[] | undefined
  disabled?: boolean
  onStep: (patch: Partial<WorkflowStepDef>) => void
}) {
  const profiles = () => props.catalog?.profiles ?? []
  const provider = () => (props.providers ?? []).find((entry) => entry.profileId === props.step.profileId)
  // Sorted so model comes first and reasoning second, which is the order a person reaches for them.
  const options = () => [...(provider()?.configOptions ?? [])]
    .sort((a, b) => (OPTION_ORDER[a.category] ?? 9) - (OPTION_ORDER[b.category] ?? 9) || a.label.localeCompare(b.label))

  const setOption = (id: string, value: string): void => {
    const current = { ...(props.step.configOptions ?? {}) }
    if (value) current[id] = value
    else delete current[id]
    props.onStep({ configOptions: Object.keys(current).length ? current : undefined })
  }

  return (
    <Stack gap="row">
      <Field label="Harness" hint="Which agent runs this step. The node's own profiles." group>
        <Select
          size="sm"
          label="Harness"
          disabled={props.disabled}
          value={props.step.profileId ?? ''}
          options={[
            { value: '', label: 'The workflow default' },
            ...profiles().map((profile) => ({ value: profile.id, label: profile.label })),
          ]}
          onChange={(value) => props.onStep({ profileId: value || undefined })}
        />
      </Field>

      {/* One select per option the harness advertises. A harness that advertises none draws none,
          which is the honest answer for a profile with no managed driver. */}
      <For each={options()}>
        {(option) => (
          <Field label={option.label} group>
            <Select
              size="sm"
              label={option.label}
              disabled={props.disabled}
              value={props.step.configOptions?.[option.id] ?? ''}
              options={[
                { value: '', label: option.currentValue ? `The harness default (${option.currentValue})` : 'The harness default' },
                ...option.values.map((value) => ({ value: value.value, label: value.label, title: value.description })),
              ]}
              onChange={(value) => setOption(option.id, value)}
            />
          </Field>
        )}
      </For>
      <Show when={props.step.profileId && !provider()}>
        <Field
          hint="This harness is not installed on this node, so its model and thinking levels cannot be listed here."
          group
        >
          <Select size="sm" label="Options" disabled options={[{ value: '', label: 'Nothing to choose' }]} value="" />
        </Field>
      </Show>

      <Field
        label="Where it runs"
        hint="A shared step runs in the task's own checkout beside its siblings. Its own worktree gives it a child task and a branch, which is what a step that writes code needs."
        group
      >
        <SegmentedControl
          size="sm"
          ariaLabel="Where it runs"
          value={props.step.isolation ?? 'shared'}
          options={[
            { value: 'shared', label: 'Shared task' },
            { value: 'worktree', label: 'Own worktree' },
          ]}
          onChange={(value) => props.onStep({ isolation: value === 'shared' ? undefined : 'worktree' })}
        />
      </Field>

      <Field
        label="Upstream output"
        hint="Append puts what every step it waits on returned after the prompt. Only where referenced expects the prompt to place them itself."
        group
      >
        <SegmentedControl
          size="sm"
          ariaLabel="Upstream output"
          value={props.step.inputs ?? 'append'}
          options={[
            { value: 'append', label: 'Append' },
            { value: 'template', label: 'Only where referenced' },
            { value: 'none', label: 'None' },
          ]}
          onChange={(value) => props.onStep({ inputs: value === 'append' ? undefined : (value as 'template' | 'none') })}
        />
      </Field>
    </Stack>
  )
}
