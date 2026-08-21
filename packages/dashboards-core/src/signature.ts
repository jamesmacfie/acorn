import type { PanelDefinition } from './model'

// What makes a recorded series still true. See docs/dashboards.md § Sampling and retention for what
// goes into the signature and why the rest is left out.

/** Deterministic JSON: object keys sorted at every depth, so two definitions that differ only in the
 *  order their keys happen to be spelled hash the same. `JSON.stringify` alone does not do this, and
 *  a codec's spread order is not something a stored series should depend on. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
}

/** FNV-1a, 32-bit, hex. Not a cryptographic hash and nothing here needs one: the signature answers
 *  "is this still the same panel?" against a value this node wrote itself minutes ago. A collision
 *  would mean a series survives an edit it should have been reset by, a wrong trend rather than a
 *  security hole, and at one string per panel per hour the odds are not worth a dependency. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function measureSignature(panel: PanelDefinition): string {
  return fnv1a(stableStringify({
    queries: panel.queries.map((query) => ({ pluginId: query.pluginId, collectionId: query.collectionId, params: query.params ?? {} })),
    mapping: panel.mapping ?? {},
    filters: panel.shaping.filters ?? [],
    aggregate: panel.view.aggregate ?? 'count',
    field: panel.view.field ?? '',
  }))
}
