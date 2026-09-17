import { describe, expect, it } from 'vitest'
import { renderBlocks, renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders common markdown', () => {
    expect(renderMarkdown('**bold** and *em* and `code`')).toBe('<p><strong>bold</strong> and <em>em</em> and <code>code</code></p>')
    expect(renderMarkdown('# Title')).toBe('<h1>Title</h1>')
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('[link](https://x.com)')).toBe('<p><a href="https://x.com" target="_blank" rel="noreferrer">link</a></p>')
    expect(renderMarkdown('![image.png](https://uploads.linear.app/image.png)')).toBe(
      '<p><img src="https://uploads.linear.app/image.png" alt="image.png" loading="lazy" decoding="async" referrerpolicy="no-referrer"></p>',
    )
  })

  it('links a bare URL, once, and leaves the trailing punctuation out of it', () => {
    expect(renderMarkdown('PR is up: https://github.com/a/b/pull/1.')).toBe(
      '<p>PR is up: <a href="https://github.com/a/b/pull/1" target="_blank" rel="noreferrer">'
      + 'https://github.com/a/b/pull/1</a>.</p>',
    )
    // A link already written in the bracket form keeps its own text and gains no second anchor.
    expect(renderMarkdown('[the PR](https://x.com/1) and **[bold](https://x.com/2)**')).toBe(
      '<p><a href="https://x.com/1" target="_blank" rel="noreferrer">the PR</a> and '
      + '<strong><a href="https://x.com/2" target="_blank" rel="noreferrer">bold</a></strong></p>',
    )
    // A URL inside a code span is text somebody meant to read, not a destination.
    expect(renderMarkdown('`curl https://x.com`')).toBe('<p><code>curl https://x.com</code></p>')
  })

  it('is XSS-safe: escapes raw HTML and drops dangerous link schemes', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    // javascript: link → href dropped, text kept
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href')
    // code span contents are escaped, not executed
    expect(renderMarkdown('`<img onerror=x>`')).toBe('<p><code>&lt;img onerror=x&gt;</code></p>')
    // image attributes are escaped and non-http(s) sources degrade to their safe alt text
    expect(renderMarkdown('![<bad>](https://x.com/a.png?name="bad")')).toBe(
      '<p><img src="https://x.com/a.png?name=&quot;bad&quot;" alt="&lt;bad&gt;" loading="lazy" decoding="async" referrerpolicy="no-referrer"></p>',
    )
    expect(renderMarkdown('![fallback](javascript:alert)')).toBe('<p>fallback</p>')
    // `data:` is allowed for images only, and only for an image type: a plugin frame draws its
    // provider's private uploads this way (ui/markdown.ts § safeImageSrc).
    expect(renderMarkdown('![shot](data:image/png;base64,iVBORw0KGgo=)')).toBe(
      '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="shot" loading="lazy" decoding="async" referrerpolicy="no-referrer"></p>',
    )
    expect(renderMarkdown('![nope](data:text/html;base64,PHNjcmlwdD4=)')).toBe('<p>nope</p>')
    expect(renderMarkdown('[nope](data:image/png;base64,iVBORw0KGgo=)')).not.toContain('href')
    expect(renderMarkdown('`![not-an-image](https://x.com/a.png)`')).toBe(
      '<p><code>![not-an-image](https://x.com/a.png)</code></p>',
    )
  })

  it('renders a GFM table into the shared table classes', () => {
    const html = renderMarkdown('| a | b |\n| --- | :-: |\n| 1 | 2 |')
    expect(html).toBe(
      '<div class="ui-table-scroll" data-scroll><table class="ui-table">'
      + '<thead><tr><th>a</th><th>b</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td></tr></tbody>'
      + '</table></div>',
    )
  })

  it('squares a ragged row off against the header, and keeps an escaped pipe as text', () => {
    const html = renderMarkdown('a | b | c\n--- | --- | ---\n1 | 2\n1 | 2 | 3 | 4\n`x \\| y` | | ')
    expect(html).toContain('<tr><td>1</td><td>2</td><td></td></tr>')
    expect(html).toContain('<tr><td>1</td><td>2</td><td>3</td></tr>')
    expect(html).toContain('<code>x | y</code>')
  })

  it('needs the separator row, so a paragraph containing a pipe stays a paragraph', () => {
    expect(renderMarkdown('run `a | b` first')).toBe('<p>run <code>a | b</code> first</p>')
    // No blank line above it: the paragraph still has to stop at the table.
    expect(renderMarkdown('Results:\n| a |\n| --- |\n| 1 |')).toBe(
      '<p>Results:</p>\n<div class="ui-table-scroll" data-scroll><table class="ui-table">'
      + '<thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>',
    )
  })

  it('wraps a fence and carries its language for the highlighter', () => {
    expect(renderMarkdown('```ts\nconst n = 1\n```')).toBe(
      '<div class="ui-code-wrap"><pre><code data-language="ts">const n = 1</code></pre></div>',
    )
    expect(renderMarkdown('```\nplain\n```')).toContain('data-language="text"')
  })

  it('never loads a remote image when told to use placeholders', () => {
    const html = renderMarkdown('![private](https://example.com/tracker.png)', { images: 'placeholder' })
    expect(html).toContain('[image: private]')
    expect(html).not.toContain('src=')
    // A data: image is inert either way, but placeholder mode is about not rendering what the model
    // pointed at, so it stands in for that one too.
    expect(renderMarkdown('![shot](data:image/png;base64,iVBORw0KGgo=)', { images: 'placeholder' })).not.toContain('<img')
    expect(renderMarkdown('![](https://example.com/x.png)', { images: 'placeholder' })).toContain('[image: omitted]')
  })

  // The three probes from the 2026-08-27 security review. Two of them threw before the strip landed,
  // on a forged index into the code-span and image tables; the third is the same trick spelled with a
  // real index, which would have restored a token the source never wrote.
  it('escapes a source that spells the sentinel instead of throwing on it', () => {
    const S = '\uE000'
    expect(renderMarkdown(`${S}i0${S}`)).toBe('<p>i0</p>')
    expect(renderMarkdown(`${S}i0${S}`, { images: 'placeholder' })).toBe('<p>i0</p>')
    expect(renderMarkdown(`${S}7${S}`)).toBe('<p>7</p>')
    // The sentinel next to real tokens: the source's copies are gone, inline()'s own survive.
    expect(renderMarkdown(`${S}0${S} \`code\``)).toBe('<p>0 <code>code</code></p>')
  })
})

// The block split is what makes a streaming message cheap to redraw: the component holds an element per
// key and only replaces the keys that moved (kit/components/content/Markdown.tsx).
describe('renderBlocks', () => {
  const keys = (src: string, opts = {}) => renderBlocks(src, opts).map((block) => block.key)

  it('joins back to exactly what renderMarkdown returns', () => {
    const src = '# Title\n\nA para.\n\n- one\n- two\n\n```ts\nconst a = 1\n```\n\n> quoted\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |'
    expect(renderBlocks(src).map((block) => block.html).join('\n')).toBe(renderMarkdown(src))
  })

  it('changes exactly one key when a character is appended', () => {
    const src = '# Title\n\nFirst para.\n\nSecond par'
    const before = keys(src)
    const after = keys(`${src}a`)
    expect(after).toHaveLength(before.length)
    expect(after.slice(0, -1)).toEqual(before.slice(0, -1))
    expect(after.at(-1)).not.toBe(before.at(-1))
  })

  it('keeps the earlier keys when a new block starts', () => {
    const before = keys('One.\n\nTwo.')
    const after = keys('One.\n\nTwo.\n\nThree.')
    expect(after.slice(0, 2)).toEqual(before)
    expect(after).toHaveLength(3)
  })

  it('gives a fence one key that stops moving once it closes', () => {
    const closed = keys('```ts\nconst a = 1\n```\n\nProse')
    const grown = keys('```ts\nconst a = 1\n```\n\nProse and more')
    expect(grown[0]).toBe(closed[0])
    // While the fence is still open the parser reads to the end of the source, so its key does move.
    expect(keys('```ts\nconst a = 1')[0]).not.toBe(closed[0])
  })

  it('keys the image policy, because it decides the html', () => {
    const src = '![shot](https://example.com/x.png)'
    expect(keys(src, { images: 'placeholder' })).not.toEqual(keys(src))
  })

  it('tells two identical blocks apart from a changed one, not from each other', () => {
    // Content-keyed, so two identical paragraphs share a key. The component queues its spare elements
    // per key for exactly this reason.
    const [first, second] = keys('Same.\n\nSame.')
    expect(first).toBe(second)
  })
})
