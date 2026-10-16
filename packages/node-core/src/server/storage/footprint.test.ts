import { describe, expect, it } from 'vitest'
import { CapabilityRegistry, capabilityId } from '../pluginHost/capabilities'
import { mirrorFootprintCapability, mirrorFootprints } from './footprint'

describe('mirror footprints', () => {
  it("lists every plugin's mirror counts, and nothing else the registry holds", async () => {
    const capabilities = new CapabilityRegistry()
    capabilities.provide(mirrorFootprintCapability('github'), { footprint: async () => ({ pulls: 3 }) })
    capabilities.provide(mirrorFootprintCapability('gitlab-test'), { footprint: async () => ({ merges: 1 }) })
    capabilities.provide(capabilityId<unknown>('terminal.runtime'), {})
    const contributors = mirrorFootprints(capabilities)
    expect(contributors.map(({ plugin }) => plugin)).toEqual(['github', 'gitlab-test'])
    expect(await Promise.all(contributors.map(({ counts }) => counts()))).toEqual([{ pulls: 3 }, { merges: 1 }])
  })

  it('fails only its own counts when the plugin stopped after the list was read', async () => {
    const capabilities = new CapabilityRegistry()
    const provided = capabilities.provide(mirrorFootprintCapability('github'), { footprint: async () => ({}) })
    const [github] = mirrorFootprints(capabilities)
    provided.dispose()
    await expect(github!.counts()).rejects.toThrow()
  })
})
