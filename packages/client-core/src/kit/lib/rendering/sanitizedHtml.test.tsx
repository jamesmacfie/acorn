import { describe, expect, it } from 'vitest'
import { sanitizedHtmlFragment } from './sanitizedHtml'

function draw(html: string): HTMLDivElement {
  const host = document.createElement('div')
  host.append(sanitizedHtmlFragment(html))
  return host
}

describe('provider HTML boundary', () => {
  it('keeps formatting and absolute HTTPS links with host-owned attributes', () => {
    const host = draw('<h2 class="h" id="clobber">Title</h2><p><strong>Bold</strong> and <a href="https://example.com/a?b=1" target="_self" ping="https://tracker.test" onclick="run()">link</a></p><ul><li>One</li></ul><pre><code>x</code></pre>')
    expect(host.innerHTML).toBe('<h2>Title</h2><p><strong>Bold</strong> and <a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">link</a></p><ul><li>One</li></ul><pre><code>x</code></pre>')
  })

  it('drops scripts, foreign markup, forms, resource loads and event/style attributes', () => {
    const host = draw('<p style="background:url(https://tracker.test/a)" onmouseover="run()">safe<img src="https://tracker.test/pixel" onerror="run()"><svg><a href="https://tracker.test"><text>svg</text></a></svg><math><mi>math</mi></math><iframe src="https://tracker.test">iframe</iframe><form action="https://tracker.test"><button>submit</button></form><link rel="preload" href="https://tracker.test"><video poster="https://tracker.test/p"></video></p><script>run()</script><style>@import "https://tracker.test"</style>')
    expect(host.textContent).toBe('safe')
    expect(host.querySelector('[src], [style], [onerror], [onmouseover], [href]')).toBeNull()
  })

  it('refuses obscured, relative and credentialed hrefs while preserving link text', () => {
    const host = draw('<a href="&#x6a;avascript:alert(1)">js</a><a href="https:&#10;//evil.test">newline</a><a href="https://u:p@evil.test/">credential</a><a href="/relative">relative</a><a href="data:text/html,alert(1)">data</a><a href="https://good.test/">good</a>')
    expect(host.textContent).toBe('jsnewlinecredentialrelativedatagood')
    expect([...host.querySelectorAll('a')].map((a) => a.href)).toEqual(['https://good.test/'])
  })

  it('does not move parser-created nodes or namespace tricks into the live tree', () => {
    const host = draw('<svg><foreignObject><img src="https://tracker.test/pixel"></foreignObject></svg><math><mtext><table><a href="javascript:run()">bad</a></table></mtext></math><p><unknown onclick="run()"><b>ordinary text</b></unknown></p>')
    expect(host.innerHTML).toBe('<p><b>ordinary text</b></p>')
  })

  it('bounds pathological provider markup', () => {
    expect(draw('a'.repeat(1_000_001)).textContent).toBe('[HTML content exceeds display limit]')
    expect(draw('<b>'.repeat(70) + 'x' + '</b>'.repeat(70)).textContent).toBe('[HTML content exceeds display limit]')
  })
})
