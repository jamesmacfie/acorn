import { Heading, Link, Stack, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Heading and Link',
  caption: 'A heading with an eyebrow, a smaller heading, and a link to a web page.',
  terminal: { columns: 60, rows: 5 },
  width: 480,
}

export default function HeadingsAndLinks() {
  return (
    <Stack gap="row">
      <Heading level={1} eyebrow="Linear · ACO-12">
        Redirect loop after sign-in
      </Heading>
      <Heading level={3}>Steps to reproduce</Heading>
      <Text>Open a deep link while signed out.</Text>
      <Link href="https://linear.app/acme/issue/ACO-12">Open in Linear</Link>
    </Stack>
  )
}
