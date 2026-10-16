import { ModelBackendPicker } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'ModelBackendPicker',
  caption: 'A stored key chosen, and one of its models.',
  terminal: { columns: 60, rows: 1 },
  width: 480,
}

export default function ModelBackendPickerSpecimen() {
  return (
    <ModelBackendPicker
      backendId="connection:acme"
      modelId="claude-sonnet-5-5"
      backends={[
        {
          id: 'connection:acme',
          kind: 'connection',
          label: 'Anthropic key',
          defaultModelId: 'claude-sonnet-5-5',
          models: [
            { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
            { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
          ],
        },
        { id: 'harness:claude', kind: 'harness', label: 'Claude Code', defaultModelId: '', models: [] },
      ]}
      onChange={() => {}}
    />
  )
}
