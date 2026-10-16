import { Markdown } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'Markdown',
  caption: 'A heading, a paragraph with code and a link, and a list.',
  terminal: { columns: 60, rows: 7 },
  width: 480,
}

export default function MarkdownSpecimen() {
  return (
    <Markdown
      text={[
        '### Release notes',
        '',
        'Sign-in now keeps the `next` parameter. See [the issue](https://linear.app/acme/issue/ACO-12).',
        '',
        '- Fixes the redirect loop',
        '- Adds a test for deep links',
      ].join('\n')}
    />
  )
}
