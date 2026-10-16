import { Section, SectionHeader, Stack, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Section and SectionHeader',
  caption: 'A section with a count and help, and a section header over a run of text.',
  terminal: { columns: 60, rows: 7 },
  width: 480,
}

export default function SectionSpecimen() {
  return (
    <Stack gap="section">
      <Section label="Reviewers" count={2} help="People asked to review this pull request.">
        <Text>alex, sam</Text>
      </Section>
      <Stack gap="row">
        <SectionHeader level="group">Description</SectionHeader>
        <Text>Signing in from a deep link now returns to that link.</Text>
      </Stack>
    </Stack>
  )
}
