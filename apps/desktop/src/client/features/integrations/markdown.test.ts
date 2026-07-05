import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders common markdown', () => {
    expect(renderMarkdown('**bold** and *em* and `code`')).toBe('<p><strong>bold</strong> and <em>em</em> and <code>code</code></p>')
    expect(renderMarkdown('# Title')).toBe('<h1>Title</h1>')
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('[link](https://x.com)')).toBe('<p><a href="https://x.com" target="_blank" rel="noreferrer">link</a></p>')
  })

  it('is XSS-safe: escapes raw HTML and drops dangerous link schemes', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    // javascript: link → href dropped, text kept
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href')
    // code span contents are escaped, not executed
    expect(renderMarkdown('`<img onerror=x>`')).toBe('<p><code>&lt;img onerror=x&gt;</code></p>')
  })
})
