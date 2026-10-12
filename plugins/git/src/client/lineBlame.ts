import { writeJson } from '@acorn/plugin-api/client'
import type { PluginAnnotationKey, PluginAnnotationMark } from '@acorn/protocol/extensionPoints.ts'
import { lineBlameRoute } from '../shared/api'

/** Git's answer for Editor's cursor line. The host sanitizes each mark and drops a late one. */
export const readLineBlame = async (
  keys: PluginAnnotationKey[],
  signal: AbortSignal,
): Promise<PluginAnnotationMark[]> =>
  (
    await writeJson<{ items?: PluginAnnotationMark[] }>(lineBlameRoute, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys }),
      signal,
    })
  ).items ?? []
