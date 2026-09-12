import { isDeepStrictEqual } from 'node:util'

const owns = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

/**
 * Applies the caller's changes to the latest session configuration.
 *
 * Provider metadata can arrive while a config write is awaiting the provider. Comparing the
 * requested object with the snapshot the caller read keeps those concurrent additions, while still
 * preserving the full-replacement contract for keys the caller changed or removed.
 */
export function mergeSessionConfigChange(
  base: Record<string, unknown>,
  requested: Record<string, unknown>,
  latest: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...latest }
  const candidateKeys = new Set([...Object.keys(base), ...Object.keys(requested)])
  for (const key of candidateKeys) {
    const baseOwns = owns(base, key)
    const requestedOwns = owns(requested, key)
    if (
      baseOwns === requestedOwns
      && (!baseOwns || isDeepStrictEqual(base[key], requested[key]))
    ) continue
    if (requestedOwns) merged[key] = requested[key]
    else delete merged[key]
  }
  return merged
}
