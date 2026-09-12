import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasHostCapability } from './hostCapabilities'

// The three questions `requires` can ask, answered against a host object. The seam arm is the point
// of the file: a pane gated on a seam group has to disappear on a shell that ships without it, which
// is a supported product state (../platform/contract.ts pins the no-preview shape).

const disabled = vi.hoisted(() => ({ names: [] as string[] }))
vi.mock('./nodePlugins', () => ({ disabledNodePlugins: () => disabled.names }))

const host = (acorn: unknown): void => {
  vi.stubGlobal('window', { acorn })
}

const previewGroup = {
  ensure: () => {}, setBounds: () => {}, show: () => {}, hide: () => {},
  load: () => {}, command: () => {}, evict: () => {}, onEvent: () => () => {},
}

afterEach(() => {
  vi.unstubAllGlobals()
  disabled.names = []
})

describe('hasHostCapability', () => {
  it('no requirement is met by every host, however it is spelled', () => {
    host(undefined)
    expect(hasHostCapability()).toBe(true)
    expect(hasHostCapability('none')).toBe(true)
    expect(hasHostCapability([])).toBe(true)
  })

  it("'desktop' asks whether a shell is hosting the renderer", () => {
    host(undefined)
    expect(hasHostCapability('desktop')).toBe(false)
    host({ desktop: true, platform: 'darwin' })
    expect(hasHostCapability('desktop')).toBe(true)
  })

  it('{ plugin } asks the node roster', () => {
    host(undefined)
    expect(hasHostCapability({ plugin: 'agents' })).toBe(true)
    disabled.names = ['agents']
    expect(hasHostCapability({ plugin: 'agents' })).toBe(false)
  })

  it('{ seam } asks the platform seam, so a shell without preview views never offers the pane', () => {
    // A desktop shell that installed everything but the preview group. `'desktop'` would have said
    // yes here, which is the gate this replaced.
    host({ desktop: true, platform: 'darwin' })
    expect(hasHostCapability({ seam: 'preview' })).toBe(false)
    expect(hasHostCapability('desktop')).toBe(true)

    host({ desktop: true, platform: 'darwin', preview: previewGroup })
    expect(hasHostCapability({ seam: 'preview' })).toBe(true)
  })

  it('an array means all of them', () => {
    host({ desktop: true, platform: 'darwin', preview: previewGroup })
    expect(hasHostCapability(['desktop', { seam: 'preview' }])).toBe(true)
    disabled.names = ['preview']
    expect(hasHostCapability([{ seam: 'preview' }, { plugin: 'preview' }])).toBe(false)
  })
})
