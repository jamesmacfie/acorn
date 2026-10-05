import { describe, expect, it } from 'vitest'
import { scrubDiagram } from './mermaid'

// What a diagram may keep. Mermaid itself only runs in a real browser, because it measures text, so
// these feed the scrub the kinds of markup a hostile diagram can get through mermaid's own sanitizer.
const scrub = (svg: string): HTMLDivElement => {
  const host = document.createElement('div')
  host.append(scrubDiagram(svg))
  return host
}

describe('scrubDiagram', () => {
  it('keeps the drawing and its references to itself', () => {
    const host = scrub(
      '<svg id="d"><style>#d .node rect { fill: #333; }</style>'
      + '<path marker-end="url(#d-arrow)"></path><use href="#d-shape"></use></svg>',
    )
    expect(host.querySelector('style')?.textContent).toContain('fill: #333')
    expect(host.querySelector('path')?.getAttribute('marker-end')).toBe('url(#d-arrow)')
    expect(host.querySelector('use')?.getAttribute('href')).toBe('#d-shape')
  })

  it('drops every element that fetches', () => {
    const host = scrub(
      '<svg><image href="https://x.test/a.png"></image>'
      + '<foreignObject><div><img src="https://x.test/b.png"></div></foreignObject></svg>',
    )
    expect(host.querySelector('image, img')).toBeNull()
    expect(host.querySelector('foreignObject div')).not.toBeNull()
  })

  it('drops links and remote CSS from attributes', () => {
    const host = scrub(
      '<svg><a href="https://x.test"><text>go</text></a>'
      + '<rect style="fill: url(https://x.test/c.svg)" onclick="alert(1)"></rect></svg>',
    )
    expect(host.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(host.querySelector('rect')?.hasAttribute('style')).toBe(false)
    expect(host.querySelector('rect')?.hasAttribute('onclick')).toBe(false)
  })

  it('drops a stylesheet that could fetch, escapes included', () => {
    for (const css of ['@import "https://x.test/a.css";', 'rect { fill: u\\72l(https://x.test) }', 'rect { background: image-set("https://x.test" 1x) }']) {
      expect(scrub(`<svg><style>${css}</style><rect></rect></svg>`).querySelector('style')).toBeNull()
    }
  })
})
