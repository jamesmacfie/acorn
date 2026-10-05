import { createHash } from 'node:crypto'

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

/** Stable persisted identity for workflow definitions and processing inputs. */
export function workflowContentFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}
