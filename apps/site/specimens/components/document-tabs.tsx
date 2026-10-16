import { DocumentTabs } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'DocumentTabs',
  caption: 'Three open files, the first with unsaved changes and the last a preview.',
  terminal: { columns: 60, rows: 1 },
  width: 480,
}

export default function DocumentTabsSpecimen() {
  return (
    <DocumentTabs
      idPrefix="files"
      ariaLabel="Open files"
      active="login"
      tabs={[
        { id: 'login', label: 'login.ts', dirty: true },
        { id: 'session', label: 'session.ts' },
        { id: 'readme', label: 'README.md', ephemeral: true },
      ]}
      onActivate={() => {}}
      onClose={() => {}}
    />
  )
}
