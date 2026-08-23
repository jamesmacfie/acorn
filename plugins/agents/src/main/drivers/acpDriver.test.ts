import { describe, expect, it } from 'vitest'
import { AcpDriver } from './acpDriver'
import { harnessCapabilities } from './harness'

// The generic driver's one branch worth pinning: resolving the two spawn forms into a descriptor
// without spawning anything. `probe()` never throws, so a harness that cannot start shows up as a row
// with a diagnostic rather than as a failed discovery.

describe('the generic ACP driver describes a harness before it starts one', () => {
  it('reports a command-form harness as uninstalled when its CLI is not on PATH', async () => {
    const descriptor = await new AcpDriver({
      id: 'nowhere',
      profileId: 'nowhere',
      label: 'Nowhere',
      spawn: { command: 'acorn-harness-that-does-not-exist', args: ['acp'] },
    }).probe()

    expect(descriptor.installed).toBe(false)
    expect(descriptor.diagnostics).toEqual(['acorn-harness-that-does-not-exist is not available on PATH.'])
    expect(descriptor.executable).toBeUndefined()
    // Never guessed from an id list: no probe was declared, so the health row shows installed-or-not.
    expect(descriptor.authenticated).toBeNull()
  })

  it('reports an entry-form harness as uninstalled when the adapter cannot be resolved', async () => {
    const descriptor = await new AcpDriver({
      id: 'adapterless',
      profileId: 'adapterless',
      label: 'Adapterless',
      spawn: {
        entry: () => {
          throw new Error('no such module')
        },
      },
    }).probe()

    expect(descriptor.installed).toBe(false)
    expect(descriptor.diagnostics).toEqual(['The Adapterless ACP adapter is unavailable.'])
  })

  it('finds a command-form harness on PATH and asks the declared auth probe about it', async () => {
    const asked: string[] = []
    const descriptor = await new AcpDriver({
      // `node` is the one executable this suite can rely on being on PATH.
      id: 'node-harness',
      profileId: 'node-harness',
      label: 'Node harness',
      spawn: { command: 'node' },
      probeAuth: async (executable) => {
        asked.push(executable)
        return true
      },
    }).probe()

    expect(descriptor.installed).toBe(true)
    expect(descriptor.diagnostics).toEqual([])
    expect(descriptor.executable).toMatch(/node$/)
    expect(descriptor.authenticated).toBe(true)
    // Asked about the resolved absolute path, not the bare name.
    expect(asked).toEqual([descriptor.executable])
  })

  it('derives capabilities from the protocol baseline plus the declared quirks', () => {
    expect(harnessCapabilities(undefined)).not.toContain('resume')
    expect(harnessCapabilities(undefined)).not.toContain('compact')
    expect(harnessCapabilities({ sessionPersistence: true })).toContain('resume')
    expect(harnessCapabilities({ manualCompaction: true })).toContain('compact')
    // The baseline is what the protocol defines and the shared normalizer maps, so it holds for every
    // ACP harness whether or not that harness declares anything.
    expect(harnessCapabilities(undefined)).toContain('permissions')
  })
})
