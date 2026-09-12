/** @jsxImportSource solid-js */
import { render } from 'solid-js/web'
import { describe, expect, it } from 'vitest'
import Icon from './Icon'
import { eagerIconNodes, loadIconNodes } from '../../tokens/iconNodes'

// The three ways a name can resolve, which is the whole contract of the eager/lazy split
// (docs/ui-design.md § Icons, kit/tokens/iconNodes.ts).
describe('Icon', () => {
  const draw = (name: string) => {
    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(() => <Icon name={name} />, host)
    return { host, dispose: () => { dispose(); host.remove() } }
  }

  it('draws an eager name as an SVG on the first pass, with no await', () => {
    const { host, dispose } = draw('pin')
    expect(host.querySelector('svg')).not.toBeNull()
    expect(host.querySelector('svg > path, svg > circle, svg > line, svg > rect, svg > polyline')).not.toBeNull()
    dispose()
  })

  it('draws a lazy name as its own text first, then as an SVG once the map arrives', async () => {
    // Two properties in one, because they are the same frame: `chef-hat` is a real Lucide icon that
    // nothing in this tree spells, so the census leaves it out of the eager half.
    expect(eagerIconNodes['chef-hat']).toBeUndefined()
    const { host, dispose } = draw('chef-hat')
    expect(host.querySelector('svg')).toBeNull()
    expect(host.querySelector('span.glyph')?.textContent).toBe('chef-hat')

    await loadIconNodes()
    expect(host.querySelector('svg')).not.toBeNull()
    expect(host.querySelector('span.glyph')).toBeNull()
    dispose()
  })

  it('leaves a name Lucide has never heard of as text', async () => {
    // Load-bearing, not a nicety: Lucide has no brand icons, so provider marks and about 120 inline
    // glyph literals across plugins/ resolve this way on purpose.
    await loadIconNodes()
    const { host, dispose } = draw('⚡')
    expect(host.querySelector('svg')).toBeNull()
    expect(host.querySelector('span.glyph')?.textContent).toBe('⚡')
    dispose()
  })
})
