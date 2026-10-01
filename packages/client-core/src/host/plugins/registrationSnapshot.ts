import type { EligiblePlugin } from './contributions'

// Manifest objects arrive from different Node rosters. Property order is not part of a declaration;
// array order is, because it controls deterministic registration and arbitration.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
  }
  return value
}

export const registrationSnapshot = (entry: EligiblePlugin): string => {
  const { version, apiVersion, unknown, permissions, contributions, emits, icon, icons, client } = entry.installed
  return JSON.stringify(canonical({ hash: entry.hash, trusted: entry.trusted, inactive: entry.inactive === true,
    installed: { version, apiVersion, unknown, permissions, contributions, emits, icon, icons, client: client?.hash ?? null },
  }))
}
