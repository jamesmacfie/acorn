// Docker preferences: one JSON pref (docker_prefs) read reactively from the prefs query and
// written through saveJsonPref. The slice declares durability/bounds for the persistence layer.
import type { QueryClient } from '@tanstack/solid-query'
import { z } from 'zod'
import { PrefKeys } from '@acorn/client-core/persistence/prefKeys.ts'
import type { PersistedStateSlice } from '@acorn/client-core/persistence/persistedState.ts'
import { saveJsonPref } from '@acorn/client-core/settings/savePref.ts'

export type DockerPrefs = {
  confirmDestructive: boolean // two-click confirm on remove/prune/compose-down
  showStopped: boolean // show the Stopped section in the browse
}

export const defaultDockerPrefs: DockerPrefs = { confirmDestructive: true, showStopped: true }

const dockerPrefsSchema = z.strictObject({
  confirmDestructive: z.boolean().optional(),
  showStopped: z.boolean().optional(),
})

export function readDockerPrefs(prefs: Record<string, string> | undefined): DockerPrefs {
  try {
    const raw = prefs?.[PrefKeys.dockerPrefs]
    if (!raw) return defaultDockerPrefs
    const parsed = dockerPrefsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? { ...defaultDockerPrefs, ...parsed.data } : defaultDockerPrefs
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
