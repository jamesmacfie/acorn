import { Field, Input, SectionHeader, Select, Stack, Textarea } from '@acorn/plugin-api/ui'
import type { WorkflowBudget, WorkflowDef } from '../../shared/workflowContracts'
import TimeBudgetField from './TimeBudgetField'

export default function DefinitionInspector(props: {
  def: WorkflowDef
  disabled?: boolean
  onChange: (patch: Partial<WorkflowDef>) => void
}) {
  const budget = (): WorkflowBudget => props.def.budget ?? {}
  const setBudget = (key: keyof WorkflowBudget, value: number | undefined): void => {
    const next = { ...budget() }
    if (value !== undefined) next[key] = value
    else delete next[key]
    props.onChange({ budget: Object.keys(next).length ? next : undefined })
  }
  const number = (value: string): number | undefined => (value.trim() ? Number(value) : undefined)

  return (
    <Stack gap="stack">
      <Field label="Name" group>
        <Input label="Name" disabled={props.disabled} value={props.def.name}
          onInput={(value) => props.onChange({ name: value })} />
      </Field>
      <Field label="Approvals" hint="To skip approvals, set a tool limit below." group>
        <Select label="Approvals" disabled={props.disabled} value={props.def.posture ?? 'gated'}
          options={[{ value: 'gated', label: 'Stop and ask' }, { value: 'autonomous', label: 'Skip' }]}
          onChange={(value) => props.onChange({ posture: value === 'gated' ? undefined : 'autonomous' })} />
      </Field>

      <SectionHeader level="sub">Tools</SectionHeader>
      <Field label="Riskiest tools allowed" group>
        <Select label="Riskiest tools allowed" disabled={props.disabled}
          value={props.def.tools?.maxRisk ?? ''}
          options={[
            { value: '', label: 'No limit' },
            { value: 'read', label: 'Read only' },
            { value: 'write', label: 'Read and write' },
            { value: 'execute', label: 'Anything, including commands' },
          ]}
          onChange={(value) => props.onChange({
            tools: { ...props.def.tools, maxRisk: (value || undefined) as 'read' | 'write' | 'execute' | undefined },
          })} />
      </Field>
      <Field label="Only these tools" hint="One tool name per line. Leave it empty to allow any tool under the limit." group>
        <Textarea rows={3} mono assist={false} label="Only these tools" disabled={props.disabled}
          value={(props.def.tools?.allow ?? []).join('\n')}
          onInput={(value) => {
            const allow = value.split('\n').map((line) => line.trim()).filter(Boolean)
            props.onChange({ tools: { ...props.def.tools, allow: allow.length ? allow : undefined } })
          }} />
      </Field>

      <SectionHeader level="sub">Limits</SectionHeader>
      <Field label="Most child tasks" help="Counts every task the run makes, however deep. Up to 500." group>
        <Input type="number" width="narrow" label="Most child tasks" placeholder="100" disabled={props.disabled}
          value={props.def.maxDescendants ?? ''}
          onInput={(value) => props.onChange({ maxDescendants: number(value) })} />
      </Field>
      <Field label="Agents at once" help="Only running agents count. Steps that wait or read data don't." group>
        <Input type="number" width="narrow" label="Agents at once" placeholder="4" disabled={props.disabled}
          value={props.def.maxConcurrency ?? ''}
          onInput={(value) => props.onChange({ maxConcurrency: number(value) })} />
      </Field>

      <SectionHeader level="sub">Budget</SectionHeader>
      <Field label="Cost limit in US dollars" group>
        <Input type="number" width="narrow" label="Cost limit in US dollars" disabled={props.disabled}
          value={budget().maxCostUsd ?? ''} onInput={(value) => setBudget('maxCostUsd', number(value))} />
      </Field>
      <TimeBudgetField label="Workflow timeout in minutes"
        hint="Limits the whole run, including child workflows. Leave empty for no run limit. Without a time budget, agent turns default to 10 minutes."
        budget={props.def.budget} disabled={props.disabled}
        onChange={(budget) => props.onChange({ budget })} />
      <Field label="Agent turns" group>
        <Input type="number" width="narrow" label="Agent turns" disabled={props.disabled}
          value={budget().maxTurns ?? ''} onInput={(value) => setBudget('maxTurns', number(value))} />
      </Field>
    </Stack>
  )
}
