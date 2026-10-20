import { describe, expect, it } from 'vitest'
import { richTooltipDom } from './richTooltip'

// Commit messages and hover answers are plugin content, so the one renderer both use must not run a
// script, load an image, or keep a link that isn't https.
describe('richTooltipDom', () => {
  it('draws markdown safely, with the host credit last', () => {
    const dom = richTooltipDom(
      {
        kind: 'markdown',
        value: [
          '**Fix** <script>window.ran = true</script>',
          '<img src="https://example.com/a.png" onerror="window.ran = true">',
          '![logo](https://example.com/logo.png)',
          '[safe](https://example.com) [unsafe](javascript:alert(1)) [plain](http://example.com)',
        ].join('\n\n'),
      },
      'Git',
    )
    document.body.append(dom)
    expect(dom.querySelector('strong')?.textContent).toBe('Fix')
    expect(dom.querySelector('script')).toBeNull()
    expect(dom.querySelector('img')).toBeNull()
    const links = [...dom.querySelectorAll('a')].map((link) => link.getAttribute('href') ?? '')
    expect(links).toContain('https://example.com/')
    expect(links.every((href) => href.startsWith('https://'))).toBe(true)
    expect((window as { ran?: boolean }).ran).toBeUndefined()
    expect(dom.lastElementChild?.textContent).toBe('From Git')
    dom.remove()
  })

  it('draws plain text and a bare string as text', () => {
    expect(richTooltipDom({ kind: 'plaintext', value: '**not bold**' }, 'Git').querySelector('strong')).toBeNull()
    expect(richTooltipDom('You, not committed yet', 'Git').textContent).toBe('You, not committed yetFrom Git')
  })
})
