import { afterEach, describe, expect, it } from 'vitest'
import { _resetWsChannels, registerWsChannel, routeWsFrame, wsChannelPrefixes, wsReattachFrames } from './wsChannels'

afterEach(() => _resetWsChannels())

describe('ws channel registry', () => {
  it('routes on the token before the first colon, and drops an unclaimed prefix', () => {
    const seen: string[] = []
    registerWsChannel('docker', (frame) => seen.push(frame.channel))
    routeWsFrame({ channel: 'docker:exec:out', execId: 'e1', data: 'x' })
    // Nobody claimed 'ghost'. A drop is the honest outcome; it is also what happens when the
    // owning plugin is disabled on this node, but it is now silent, where the old if/else had a
    // dead branch. That is why bootClientPlugins pins its prefix set (apps/desktop).
    routeWsFrame({ channel: 'ghost:thing' })
    expect(seen).toEqual(['docker:exec:out'])
  })

  it('throws on a duplicate prefix rather than replacing', () => {
    registerWsChannel('term', () => {})
    expect(() => registerWsChannel('term', () => {})).toThrow(/already registered/)
  })

  it('collects reattach frames from every owner, at call time', () => {
    let attached = ['a']
    registerWsChannel('docker', () => {}, () => attached.map((id) => ({ channel: 'docker:logs:attach', id })))
    registerWsChannel('term', () => {}) // no reattach hook: contributes nothing
    expect(wsReattachFrames()).toEqual([{ channel: 'docker:logs:attach', id: 'a' }])
    // Recomputed, not captured: a pane that mounted since the last reconnect must be re-attached too.
    attached = ['a', 'b']
    expect(wsReattachFrames()).toHaveLength(2)
  })

  it('disposal is idempotent and never clobbers a later registration', () => {
    const first = registerWsChannel('docker', () => {})
    first.dispose()
    first.dispose()
    registerWsChannel('docker', () => {})
    first.dispose()
    expect(wsChannelPrefixes()).toEqual(['docker'])
  })
})
