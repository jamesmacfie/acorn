import { QueryClient } from '@tanstack/solid-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { PrefKeys } from '@acorn/plugin-api/client'
import { defaultDockerPrefs, readDockerPrefs, saveDockerPref } from './dockerPrefs'

// One key holding two switches, so the only interesting question is what happens to the switch you did
// not touch. Settings → Docker and the palette's setting command both write through `saveDockerPref`
// for exactly this reason (docs/command-palette-and-shortcuts.md).

const stored = (): Record<string, string> => ({
  [PrefKeys.dockerPrefs]: localStorage.getItem(`acorn-pref:${PrefKeys.dockerPrefs}`) ?? '',
})

describe('the docker preferences', () => {
  beforeEach(() => localStorage.clear())

  it('confirms destructive actions and shows stopped containers until told otherwise', () => {
    expect(readDockerPrefs(undefined)).toEqual(defaultDockerPrefs)
    // A corrupt value is not a setting: it reads as the default rather than as "off".
    expect(readDockerPrefs({ [PrefKeys.dockerPrefs]: 'not json' })).toEqual(defaultDockerPrefs)
  })

  it('leaves the switch nobody touched alone', async () => {
    const qc = new QueryClient()
    await saveDockerPref(qc, undefined, 'showStopped', false)
    expect(readDockerPrefs(stored())).toEqual({ confirmDestructive: true, showStopped: false })

    await saveDockerPref(qc, stored(), 'confirmDestructive', false)
    expect(readDockerPrefs(stored())).toEqual({ confirmDestructive: false, showStopped: false })
  })
})
