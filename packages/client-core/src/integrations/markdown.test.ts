import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

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
    // provider's private uploads this way (integrations/markdown.ts § safeImageSrc).
    expect(renderMarkdown('![shot](data:image/png;base64,iVBORw0KGgo=)')).toBe(
      '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="shot" loading="lazy" decoding="async" referrerpolicy="no-referrer"></p>',
    )
    expect(renderMarkdown('![nope](data:text/html;base64,PHNjcmlwdD4=)')).toBe('<p>nope</p>')
    expect(renderMarkdown('[nope](data:image/png;base64,iVBORw0KGgo=)')).not.toContain('href')
    expect(renderMarkdown('`![not-an-image](https://x.com/a.png)`')).toBe(
      '<p><code>![not-an-image](https://x.com/a.png)</code></p>',
    )
  })
})
