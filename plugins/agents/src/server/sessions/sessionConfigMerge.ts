import { isDeepStrictEqual } from 'node:util'

const owns = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

// Written by admission or a dedicated authority operation, not generic provider configuration.
const serverOwnedKeys = [
  'toolCeiling', 'mcpServers', 'workflowRunId', 'workflowStepId', 'delegationSpawnId', 'customAgent', 'standingContext',
] as const

export function retainSessionAuthority(
  requested: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const config = { ...requested }
  for (const key of serverOwnedKeys) {
    delete config[key]
    if (owns(current, key)) config[key] = current[key]
  }
  return config
}

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
