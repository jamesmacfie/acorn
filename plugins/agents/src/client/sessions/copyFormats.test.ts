import { describe, expect, it } from 'vitest'
import { asPlainText } from './copyFormats'

describe('copying an answer as plain text', () => {
  it('takes the markup out and leaves the words', () => {
    expect(asPlainText([
      '# Heading',
      '',
      'Some **bold** and *italic* and `code`.',
      '',
      '- one',
      '- two',
      '',
      '```ts',
      'const a = 1',
      '```',
      '',
      'See [the docs](https://example.com).',
    ].join('\n'))).toBe([
      'Heading',
      '',
      'Some bold and italic and code.',
      '',
      'one',
      'two',
      // The fence line takes its own line break with it, so the code sits straight under the list
      // rather than leaving a gap where the ``` used to be.
      'const a = 1',
      '',
      'See the docs.',
    ].join('\n'))
  })

  it('leaves snake_case alone', () => {
    expect(asPlainText('call some_helper_name(x)')).toBe('call some_helper_name(x)')
  })
})
