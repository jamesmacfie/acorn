import { afterEach, describe, expect, it, vi } from 'vitest'

// The FileVault probe (docs/security.md § On-disk). The subprocess is mocked because the answer on
// the machine running the suite is neither known nor interesting; what is under test is the mapping from
// what `fdesetup isactive` says to the three-valued answer the client renders — and specifically that
// every failure mode lands on `null` rather than `false`.
//
// Reporting "your disk is not encrypted" because a probe timed out would train the owner to dismiss a
// warning that matters, which is the failure this file exists to prevent.

const proc = vi.hoisted(() => ({ runProcess: vi.fn() }))
vi.mock('./core/proc', () => proc)

const result = (over: Record<string, unknown> = {}) => ({
  code: 0,
  signal: null,
  stdout: '',
  stderr: '',
  timedOut: false,
  aborted: false,
  truncated: false,
  spawnError: null,
  ...over,
})

// Imported after the mock, and re-imported per case so the module-level cache starts empty — the cache is
// the point of the last case, so it must not be shared by the others.
async function probeWith(over: Record<string, unknown>, platform = 'darwin') {
  vi.resetModules()
  proc.runProcess.mockReset()
  proc.runProcess.mockResolvedValue(result(over))
  const spy = vi.spyOn(process, 'platform', 'get').mockReturnValue(platform as NodeJS.Platform)
  const { diskEncryption } = await import('./diskEncryption')
  const answer = await diskEncryption()
  spy.mockRestore()
  return { answer, calls: proc.runProcess.mock.calls.length, run: proc.runProcess }
}

afterEach(() => vi.restoreAllMocks())

describe('diskEncryption', () => {
  it('reads `true` from fdesetup isactive', async () => {
    const { answer, run } = await probeWith({ stdout: 'true\n' })
    expect(answer).toBe(true)
    // `isactive`, not `status`: status prints prose whose wording has changed across macOS releases, and
    // parsing it is how a check like this quietly starts returning the wrong answer after an upgrade.
    expect(run.mock.calls[0][0]).toMatchObject({ file: '/usr/bin/fdesetup', args: ['isactive'] })
  })

  it('reads `false`, which is the only case that warns', async () => {
    expect((await probeWith({ stdout: 'false\n', code: 1 })).answer).toBe(false)
  })

  it('answers null when the binary is missing, when it times out, and when it says something else', async () => {
    expect((await probeWith({ spawnError: 'ENOENT' })).answer).toBeNull()
    expect((await probeWith({ timedOut: true })).answer).toBeNull()
    expect((await probeWith({ stdout: 'Deferred enablement appears to be active' })).answer).toBeNull()
  })

  it('answers null off macOS without spawning anything', async () => {
    const { answer, calls } = await probeWith({ stdout: 'true' }, 'linux')
    expect(answer).toBeNull()
    // LUKS, dm-crypt, ZFS native encryption and a dozen NAS arrangements all count; guessing is worse
    // than admitting we do not know.
    expect(calls).toBe(0)
  })

  it('probes once per process, however often it is asked', async () => {
    vi.resetModules()
    proc.runProcess.mockReset()
    proc.runProcess.mockResolvedValue(result({ stdout: 'true' }))
    const spy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { diskEncryption } = await import('./diskEncryption')
    // Concurrent as well as sequential: the cache is a promise, so an unmemoised version would spawn
    // twice for these two before either resolved.
    await Promise.all([diskEncryption(), diskEncryption()])
    await diskEncryption()
    expect(proc.runProcess).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
