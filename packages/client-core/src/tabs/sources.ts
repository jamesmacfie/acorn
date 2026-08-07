import type { Integration } from '@acorn/protocol/api.ts'
import type { SourceId } from '../tasks/tasks'
import { sourceRegistry } from '../registries/sources'

export type SourceEntry = { id: SourceId; glyph: string; label: string }

export function availableSources(integrations: Integration[] | undefined): SourceEntry[] {
  const has = (providerId: string, capability?: string) => (integrations ?? []).some(
    (i) => i.providerId === providerId && i.status !== 'disabled' && i.status !== 'needs-auth' && (!capability || i.capabilities[capability] === 'available'),
  )
  return sourceRegistry
    .entries()
    // Two independent gates, both AND-ed: `providerId` asks "is the integration behind this connected?",
    // `when` asks anything else the contribution needs (Fleet home: more than one node paired).
    .filter((source) => (!source.providerId || has(source.providerId, source.requiredCapability)) && (source.when?.() ?? true))
    // `id` breaks a tie, so two sources declaring the same order still produce a STABLE rail rather than one
    // that depends on registration after all — the same tiebreak the slot hosts use.
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(({ id, glyph, label }) => ({ id, glyph, label }))
}
