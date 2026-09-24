import { createEffect, createRoot } from 'solid-js'
import { expect, it } from 'vitest'
import { initClientPlugins, type ClientPlugin } from './plugin'
import { sourceRegistry, type SourceContribution } from '../sources/sources'

// Beside plugin.test.ts rather than in it, because this one needs effects to run, and only the jsdom
// project resolves Solid's browser build.

const source: SourceContribution<never> = {
  id: 'host.gap',
  order: 1,
  glyph: 'x',
  label: 'Gap',
  promotion: {
    canPromote: () => false,
    prepare: () => Promise.reject(new Error('not promotable')),
    create: () => Promise.reject(new Error('not promotable')),
  },
}

// Applying the node's plugin list runs this a second time. An effect that ran between a plugin's
// take-back and its re-registration found its source gone, and the shell reset the rail to Home.
it('never shows an effect a plugin taken back and not yet registered again', () => {
  const plugins: ClientPlugin[] = [{ name: 'gap', init: (ctx) => { ctx.sources.register(source) } }]
  initClientPlugins(plugins)
  const seen: boolean[] = []
  const dispose = createRoot((dispose) => {
    createEffect(() => seen.push(!!sourceRegistry.get('host.gap')))
    return dispose
  })

  initClientPlugins(plugins)

  expect(seen).not.toContain(false)
  dispose()
  initClientPlugins([{ name: 'gap', init: () => {} }])
})
