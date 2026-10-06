import type { AgentProviderDescriptor } from '@acorn/plugin-agents/contract/wire.ts'
import { Field, Fold, Select, Stack, Text } from '@acorn/plugin-api/ui'
import type { WorkflowCatalog, WorkflowMapAgent } from '../../shared/workflowContracts'
import AgentNodeForm from './AgentNodeForm'
import PromptField from './PromptField'
import SchemaFieldEditor from './SchemaFieldEditor'

export default function MapAgentForm(props: {
  agent: WorkflowMapAgent
  catalog?: WorkflowCatalog
  providers?: readonly AgentProviderDescriptor[]
  disabled?: boolean
  onChange(agent: WorkflowMapAgent): void
}) {
  const change = (patch: Partial<WorkflowMapAgent>) => props.onChange({ ...props.agent, ...patch })
  return <Stack gap="stack">
    <PromptField label="Prompt" value={props.agent.prompt} required references={[]} disabled={props.disabled}
      hint="Each session receives the current item as context. Describe what it should do with that item."
      onChange={prompt => change({ prompt })} />
    <AgentNodeForm step={{ ...props.agent, name: 'Agent session' }}
      catalog={props.catalog ? { ...props.catalog, profiles: props.catalog.profiles.filter(profile => profile.managed) } : undefined}
      providers={props.providers} sharedTask disabled={props.disabled}
      onStep={patch => change(patch)} />
    <Text emphasis="muted" wrap>Sessions run one at a time in list order, using the parent task's folder and branch. Each session has its own conversation.</Text>
    <Field label="On failure" group>
      <Select label="On failure" value={props.agent.onFailure ?? 'continue'} disabled={props.disabled}
        options={[{ value: 'continue', label: 'Continue and report' }, { value: 'stop', label: 'Stop processing items' }]}
        onChange={value => change({ onFailure: value as 'continue' | 'stop' })} />
    </Field>
    <Fold label="Agent result" level="sub">
      <SchemaFieldEditor label="Result fields" value={props.agent.schema} disabled={props.disabled} onChange={schema => change({ schema })} />
    </Fold>
  </Stack>
}
