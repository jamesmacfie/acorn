// Security floors for hosts that run loaded plugins under Node's permission model.
// Keep the package engines and node-runtime.json aligned with this policy.
export const NODE_RUNTIME_RANGE = '>=22.23.2 <23 || >=24.18.1 <25 || >=26.5.1 <27'

const floors: Readonly<Record<number, readonly [number, number]>> = {
  22: [23, 2],
  24: [18, 1],
  26: [5, 1],
}

export function isSupportedNodeRuntime(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match || match[0] !== version) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (![major, minor, patch].every(Number.isSafeInteger)) return false
  const floor = floors[major]
  return floor !== undefined && (minor > floor[0] || (minor === floor[0] && patch >= floor[1]))
}

/** Refuse permission-scoped plugin execution on unpatched or unsupported Node releases. */
export function assertSupportedNodeRuntime(version: string): void {
  if (!isSupportedNodeRuntime(version)) {
    throw new Error(`Loaded plugins require a patched Node runtime (${NODE_RUNTIME_RANGE}); found ${version}. Upgrade Node before loading plugins.`)
  }
}
