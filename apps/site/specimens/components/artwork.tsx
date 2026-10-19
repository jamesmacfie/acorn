import { Artwork, Inline, Stack, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Artwork',
  caption: 'An album cover beside its song. With no Node to read the picture from, it draws its fallback words.',
  terminal: { columns: 40, rows: 2 },
  width: 320,
}

export default function ArtworkSpecimen() {
  return (
    <Inline gap="inline">
      <Artwork
        preset="thumbnail"
        image={{ path: '/v1/p/music/art/42', revision: '42', alt: 'Album cover for Example album' }}
        fallback="EA"
      />
      <Stack gap="none">
        <Text>Example song</Text>
        <Text emphasis="muted">Example artist</Text>
      </Stack>
    </Inline>
  )
}
