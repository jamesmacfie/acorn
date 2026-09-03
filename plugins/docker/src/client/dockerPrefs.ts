// Docker preferences: one JSON pref (docker_prefs) read reactively from the prefs query and
// written through saveJsonPref. The slice declares durability/bounds for the persistence layer.
import type { QueryClient } from '@tanstack/solid-query'
import { z } from 'zod'
import { type PersistedStateSlice, PrefKeys, saveJsonPref } from '@acorn/plugin-api/client'

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

/**
 * One switch, written as a merge onto the whole record.
 *
 * Both switches share one key, so writing either on its own would drop the other back to its default.
 * One value on one persistence path: whatever writes a Docker switch comes through here, so a second
 * writer cannot drift from Settings → Docker.
 *
 * This plugin registers no `setting` command, and the accessor is still worth having on its own —
 * the merge is the part that is easy to get wrong. Adding one would be a product decision rather
 * than plumbing (docs/docker.md § From the command palette).
 */
export const saveDockerPref = (
  qc: QueryClient,
  prefs: Record<string, string> | undefined,
  key: keyof DockerPrefs,
  value: boolean,
): Promise<boolean> => saveDockerPrefs(qc, { ...readDockerPrefs(prefs), [key]: value })

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
