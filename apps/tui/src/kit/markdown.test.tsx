/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it } from 'vitest'
import { Lines, Markdown } from './showing'
import { renderMarkdown } from '@acorn/client-core/kit/lib/markdown'
import { htmlLines } from './markdown'
import { renderCells } from './render'

describe('provider HTML parsing', () => {
  it('preserves inline roles and their surrounding spaces', () => {
    const [line] = htmlLines('<p><code>account_id</code>, or <strong>serialise the package</strong>.</p>')

    expect(line.runs).toEqual([
      { text: 'account_id', role: 'mono' },
      { text: ', or ' },
      { text: 'serialise the package', role: 'strong' },
      { text: '.' },
    ])
  })

  it('ignores GitHub custom-element wrappers around tables', () => {
    const text = htmlLines(
      [
        '<markdown-accessiblity-table><table role="table"><tbody><tr>',
        '<td>serial</td><td>501 of 501 pass</td>',
        '</tr></tbody></table></markdown-accessiblity-table>',
      ].join(''),
    )
      .flatMap((line) => line.runs.map((run) => run.text))
      .join('\n')

    expect(text).toContain('serial')
    expect(text).toContain('501 of 501 pass')
    expect(text).not.toContain('markdown-accessiblity-table')
  })
})

describe('provider HTML in cells', () => {
  it('keeps spaces at inline style boundaries', async () => {
    const html = [
      '<p><code>new_framework_defaults_7_0.rb</code> had five settings. Two switched on.</p>',
      '<p>Someone switched <strong>open redirect protection</strong> on.</p>',
      '<ul><li><strong>Feature flag.</strong> None seeded.</li></ul>',
    ].join('')
    const frame = await renderCells(() => <Lines lines={htmlLines(html)} />, { width: 48, height: 7 })

    try {
      const prose = frame.lines
        .map((line) => line.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
      expect(prose).toContain('new_framework_defaults_7_0.rb had five settings. Two switched on.')
      expect(prose).toContain('Someone switched open redirect protection on.')
      expect(prose).toContain('• Feature flag. None seeded.')
    } finally {
      frame.done()
    }
  })

  it('does not squeeze a long description into overlapping rows', async () => {
    const html = [
      "<p>Scoping the reads is the better fix in principle and I'm not pretending otherwise -- but <strong>the failing read/row pair has never been identified</strong>. Shipping 93 edits on a hypothesis, when one line is measured to work, is the wrong way round.</p>",
      '<p>16 seconds is the price of a job that means something when it goes red.</p>',
      '<h2>Correction to an earlier version of this description</h2>',
      '<p>An earlier version of this text made two claims about the account leak that I later measured and found to be wrong.</p>',
      '<ul><li>First correction.</li><li>Second correction.</li></ul>',
    ].join('')
    const frame = await renderCells(
      () => (
        <box flexDirection="column" flexGrow={1} overflow="scroll">
          <Lines lines={htmlLines(html)} />
        </box>
      ),
      { width: 80, height: 8 },
    )

    try {
      const prose = frame.lines
        .map((line) => line.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
      expect(prose).toContain("Scoping the reads is the better fix in principle and I'm not pretending otherwise")
      expect(prose).toContain('Shipping 93 edits on a hypothesis')
    } finally {
      frame.done()
    }
  })
})

describe('markdown source in cells', () => {
  it('draws block by block exactly as the whole document drew, blank lines between blocks included', async () => {
    const source = '# Title\n\nA paragraph.\n\n- one\n- two\n\n```ts\nconst a = 1\n```\n\n> quoted\n\nThe end.'
    const whole = await renderCells(
      () => <Lines lines={htmlLines(renderMarkdown(source, { images: 'placeholder' }))} />,
      { width: 40, height: 20 },
    )
    const blocks = await renderCells(() => <Markdown text={source} />, { width: 40, height: 20 })
    try {
      expect(blocks.lines).toEqual(whole.lines)
    } finally {
      whole.done()
      blocks.done()
    }
  })
})
