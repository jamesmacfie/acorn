import { describe, expect, it } from 'vitest'
import { renderAgentMarkdown } from './agentMarkdown'

describe('managed-agent Markdown', () => {
  it('escapes raw HTML and unsafe links', () => {
    const html = renderAgentMarkdown('<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href=')
  })

  it('never loads provider-supplied remote images', () => {
    const html = renderAgentMarkdown('![private](https://example.com/tracker.png)')
    expect(html).toContain('[image: private]')
    expect(html).not.toContain('src=')
  })

  it('marks fenced code for owned syntax highlighting', () => {
    expect(renderAgentMarkdown('```ts\nconst n = 1\n```')).toContain('data-language="ts"')
  })
})
