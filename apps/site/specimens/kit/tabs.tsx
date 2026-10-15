import { Pane, TabPanel, Tabs, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Tabs',
  caption: 'A tab strip with the second tab active, and its panel.',
  terminal: { columns: 50, rows: 4 },
  width: 480,
}

export default function TabsSpecimen() {
  return (
    <Pane>
      <Tabs
        idPrefix="tabs"
        ariaLabel="Pull request"
        active="checks"
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'checks', label: 'Checks' },
          { id: 'files', label: 'Files' },
        ]}
      />
      <TabPanel idPrefix="tabs" id="checks" active="checks">
        <Text>All 12 checks passed.</Text>
      </TabPanel>
    </Pane>
  )
}
