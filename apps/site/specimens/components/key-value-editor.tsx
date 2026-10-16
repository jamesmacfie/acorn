import { KeyValueEditor } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'KeyValueEditor',
  caption: 'Two request headers, and the blank row that waits for a third.',
  terminal: { columns: 60, rows: 4 },
  width: 480,
}

export default function KeyValueEditorSpecimen() {
  return (
    <KeyValueEditor
      ariaLabel="Headers"
      rows={[
        { key: 'Accept', value: 'application/json' },
        { key: 'X-Request-Id', value: 'deploy-42' },
      ]}
      onChange={() => {}}
    />
  )
}
