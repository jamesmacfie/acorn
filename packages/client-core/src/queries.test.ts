import { afterEach, describe, expect, it, vi } from 'vitest'
import { repositorySource, sourceRegistry, type SourceRepository } from './registries/sources'
import { pinsOptions, reposOptions, setRepoPin, shellPullChecksOptions } from './queries'

describe('repository source query wrappers', () => {
  let disposable: { dispose(): void } | undefined

  afterEach(() => disposable?.dispose())

  it('preserves shell cache keys while delegating reads and writes to the source', async () => {
    const provider: SourceRepository = {
      repos: vi.fn(async () => [{ id: 1, owner: 'acorn', name: 'web', private: false, pushedAt: 1 }]),
      pins: vi.fn(async () => [1]),
      refreshRepos: vi.fn(async () => {}),
      setPin: vi.fn(async () => {}),
      pullChecks: vi.fn(async () => ({ checks: [{ name: 'ci', status: 'success', url: null, runId: null }] })),
    }
    disposable = sourceRegistry.register({ id: 'test.repository', order: 1, glyph: 'x', label: 'Test', repository: provider })
    const signal = new AbortController().signal

    await expect(reposOptions(true).queryFn({ signal })).resolves.toEqual(await provider.repos({ signal }))
    await expect(pinsOptions(true).queryFn({ signal })).resolves.toEqual([1])
    await expect(shellPullChecksOptions('acorn', 'web', '42', true).queryFn({ signal })).resolves.toEqual(await provider.pullChecks('acorn', 'web', '42', { signal }))
    await setRepoPin(1, true)

    expect(reposOptions(true).queryKey).toEqual(['repos'])
    expect(pinsOptions(true).queryKey).toEqual(['pins'])
    expect(shellPullChecksOptions('acorn', 'web', '42', true).queryKey).toEqual(['pull', 'acorn', 'web', '42'])
    expect(provider.setPin).toHaveBeenCalledWith(1, true)
    expect(repositorySource()).toBe(provider)
  })
})
