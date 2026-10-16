import { Fallback, Rectangle, Text } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Rectangle with a Fallback',
  caption: "A web view's box. The desktop fills it with the page, and the terminal draws the fallback.",
  terminal: { columns: 50, rows: 3 },
  width: 400,
}

export default function RectangleSpecimen() {
  return (
    <Rectangle kind="webview" label="Preview">
      <Fallback forNode="Rectangle">
        <Text>Open the preview on the desktop.</Text>
      </Fallback>
    </Rectangle>
  )
}
