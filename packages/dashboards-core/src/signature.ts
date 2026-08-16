import type { PanelDefinition } from './model'

// What makes a recorded series still true (docs/future/dashboards/measure-history.md § Invalidation).
//
// A panel whose MEANING changed must not keep its old trend: a filter added yesterday makes last
// week's samples a lie. So the sampler stamps every sample with a signature over the parts of the
// definition that change what the measure means, and a mismatch deletes the series and starts a new
// one. Drift is never papered over — the same posture the pinned-schema rule takes.
//
// IN: `queries` (ids and params), `mapping`, `shaping.filters`, `view.aggregate`, `view.field`.
// OUT, deliberately: the view KIND, sort, limit, the field projection, the title, the geometry, and
// the trend/compare/good display keys. Those change how the number is PRESENTED, not what it is —
// and a person retitling a panel or dragging it into a different column has not invalidated a
// fortnight of history.
//
// `sort` and `limit` sit on the OUT side and that is a judgement rather than an oversight: a limit
// does bound the row set an aggregate runs over. It is out because the two are shaping-for-reading —
// "show me the top ten" — and a stat with a limit is a rare enough shape that resetting everyone's
// history to cover it costs more than it buys. Move it IN the day a real panel needs it; the
// signature changing is exactly the honest reset.

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
 *  would mean a series survives an edit it should have been reset by — a wrong trend, not a
 *  security hole — and at one string per panel per hour the odds are not worth a dependency. */
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
