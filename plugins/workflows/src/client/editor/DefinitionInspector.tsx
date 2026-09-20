import { Field, Fold, Input, Select, Stack, Textarea } from '@acorn/plugin-api/ui'
import type { WorkflowBudget, WorkflowDef } from '../../shared/workflowContracts'

export default function DefinitionInspector(props: {
  def: WorkflowDef
  disabled?: boolean
  onChange: (patch: Partial<WorkflowDef>) => void
}) {
  const budget = (): WorkflowBudget => props.def.budget ?? {}
  const setBudget = (key: keyof WorkflowBudget, value: string): void => {
    const next = { ...budget() }
    if (value.trim()) next[key] = Number(value)
    else delete next[key]
    props.onChange({ budget: Object.keys(next).length ? next : undefined })
  }

  return (
    <Stack gap="stack">
      <Field label="Name" group>
        <Input size="sm" label="Name" disabled={props.disabled} value={props.def.name}
          onInput={(value) => props.onChange({ name: value })} />
      </Field>
      <Field label="Posture" hint="An autonomous run passes a human gate without stopping, so it needs a tool ceiling." group>
        <Select size="sm" label="Posture" disabled={props.disabled} value={props.def.posture ?? 'gated'}
          options={[{ value: 'gated', label: 'Gated' }, { value: 'autonomous', label: 'Autonomous' }]}
          onChange={(value) => props.onChange({ posture: value === 'gated' ? undefined : 'autonomous' })} />
      </Field>
      <Fold label="Tools" level="group">
        <Stack gap="row">
          <Field label="Highest risk allowed" group>
            <Select size="sm" label="Highest risk allowed" disabled={props.disabled}
              value={props.def.tools?.maxRisk ?? ''}
              options={[
                { value: '', label: 'No ceiling' },
                { value: 'read', label: 'Read' },
                { value: 'write', label: 'Write' },
                { value: 'execute', label: 'Execute' },
              ]}
              onChange={(value) => props.onChange({
                tools: { ...props.def.tools, maxRisk: (value || undefined) as 'read' | 'write' | 'execute' | undefined },
              })} />
          </Field>
          <Field label="Only these tools" hint="One name per line. Leave it empty to allow every tool inside the risk ceiling." group>
            <Textarea size="sm" rows={3} mono assist={false} label="Only these tools" disabled={props.disabled}
              value={(props.def.tools?.allow ?? []).join('\n')}
              onInput={(value) => {
                const allow = value.split('\n').map((line) => line.trim()).filter(Boolean)
                props.onChange({ tools: { ...props.def.tools, allow: allow.length ? allow : undefined } })
              }} />
          </Field>
        </Stack>
      </Fold>
      <Fold label="Execution limits" level="group">
        <Stack gap="row">
          <Field label="Descendant tasks" hint="Counts the whole tree, including nested follow-ups. Default 100; maximum 500." group>
            <Input size="sm" type="number" label="Descendant tasks" disabled={props.disabled} value={props.def.maxDescendants ?? ''}
              onInput={(value) => props.onChange({ maxDescendants: value.trim() ? Number(value) : undefined })} />
          </Field>
          <Field label="Concurrent agents" hint="Agents only. Waiting parents, gates, and data reads use no slot. Default 4." group>
            <Input size="sm" type="number" label="Concurrent agents" disabled={props.disabled} value={props.def.maxConcurrency ?? ''}
              onInput={(value) => props.onChange({ maxConcurrency: value.trim() ? Number(value) : undefined })} />
          </Field>
        </Stack>
      </Fold>
      <Fold label="Budget" level="group">
        <Stack gap="row">
          <Field label="Cost ceiling, in dollars" group>
            <Input size="sm" type="number" width="narrow" label="Cost ceiling" disabled={props.disabled}
              value={budget().maxCostUsd ?? ''} onInput={(value) => setBudget('maxCostUsd', value)} />
          </Field>
          <Field label="Wall clock, in milliseconds" group>
            <Input size="sm" type="number" width="narrow" label="Wall clock" disabled={props.disabled}
              value={budget().maxWallTimeMs ?? ''} onInput={(value) => setBudget('maxWallTimeMs', value)} />
          </Field>
          <Field label="Turns" group>
            <Input size="sm" type="number" width="narrow" label="Turns" disabled={props.disabled}
              value={budget().maxTurns ?? ''} onInput={(value) => setBudget('maxTurns', value)} />
          </Field>
        </Stack>
      </Fold>
    </Stack>
  )
}
