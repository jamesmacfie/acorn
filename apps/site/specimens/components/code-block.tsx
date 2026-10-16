import { CodeBlock } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'CodeBlock',
  caption: 'A command in a code block, with its copy control.',
  terminal: { columns: 60, rows: 3 },
  width: 480,
}

export default function CodeBlockSpecimen() {
  return <CodeBlock copy>{'pnpm test --filter=@acme/billing'}</CodeBlock>
}
