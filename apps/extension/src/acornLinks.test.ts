import { describe, expect, it } from 'vitest'
import { conversationLink, itemTaskLink, outsideItemLink, projectLink } from './acornLinks'

describe('Acorn links', () => {
  it("opens a handed-off item's task on the pane that shows it", () => {
    expect(itemTaskLink('n1', 'github', 't1')).toBe('acorn://n1/t/t1?pane=pr')
    // A plugin with no pane here opens the task as it was.
    expect(itemTaskLink('n1', 'linear', 't1')).toBe('acorn://n1/t/t1')
  })

  it('opens a project', () => {
    expect(projectLink('n1', 'p1')).toBe('acorn://n1/p/p1')
  })

  it('opens a conversation on the agents pane', () => {
    expect(conversationLink('n1', 't1', 's1')).toBe('acorn://n1/t/t1?pane=agents&item=s1')
  })

  it('opens an outside item by its address, and gives no link for one that cannot be', () => {
    expect(outsideItemLink('n1', 'https://github.com/acme/runn/pull/482')).toBe(
      'acorn://n1/open?url=https%3A%2F%2Fgithub.com%2Facme%2Frunn%2Fpull%2F482',
    )
    expect(outsideItemLink('n1', `https://example.com/${'x'.repeat(5000)}`)).toBeNull()
    expect(outsideItemLink('Not A Node', 'https://example.com/')).toBeNull()
  })
})
