// Docker preferences: one JSON pref (docker_prefs) read reactively from the prefs query and
// written through saveJsonPref. The slice declares durability/bounds for the persistence layer.
import type { QueryClient } from '@tanstack/solid-query'
import { PrefKeys } from '../../../core/client/persistence/prefKeys'
import type { PersistedStateSlice } from '../../../core/client/persistence/persistedState'
import { saveJsonPref } from '../../../core/client/settings/savePref'

export type DockerPrefs = {
  confirmDestructive: boolean // two-click confirm on remove/prune/compose-down
  showStopped: boolean // show the Stopped section in the browse
}

export const defaultDockerPrefs: DockerPrefs = { confirmDestructive: true, showStopped: true }

export function readDockerPrefs(prefs: Record<string, string> | undefined): DockerPrefs {
  try {
    const raw = prefs?.[PrefKeys.dockerPrefs]
    return raw ? { ...defaultDockerPrefs, ...(JSON.parse(raw) as Partial<DockerPrefs>) } : defaultDockerPrefs
  } catch {
    return defaultDockerPrefs
  }
}

export const saveDockerPrefs = (qc: QueryClient, next: DockerPrefs): Promise<boolean> =>
  saveJsonPref(qc, PrefKeys.dockerPrefs, next)

export const dockerPrefsSlice: PersistedStateSlice<Record<string, unknown>> = {
  id: 'docker.prefs',
  key: PrefKeys.dockerPrefs,
  scope: 'app',
  restore: 'workspace',
  version: 1,
  codec: {
    parse: (raw) => {
      try {
        const value = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
      } catch {
        return {}
      }
    },
    serialize: (value) => value,
  },
  empty: () => ({}),
  unknownIds: 'retain-inert',
  maxBytes: 8 * 1024,
}
