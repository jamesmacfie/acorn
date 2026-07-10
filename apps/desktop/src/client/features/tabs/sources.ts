// Source gating (docs/workspaces 04 / docs/integrations.md): which browse Sources the rail shows.
// GitHub is always available; Linear/Rollbar appear iff a connected integration row exists.
// Pure — unit tested; TabRail is the consumer.
import type { Integration } from '../../../shared/api'
import type { SourceId } from '../tasks/tasks'
import { sourceRegistry } from '../../registries/sources'

export type SourceEntry = { id: SourceId; glyph: string; label: string }

export function availableSources(integrations: Integration[] | undefined): SourceEntry[] {
  const has = (providerId: string, capability?: string) => (integrations ?? []).some(
    (i) => i.providerId === providerId && i.status !== 'disabled' && i.status !== 'needs-auth' && (!capability || i.capabilities[capability] === 'available'),
  )
  return [
    { id: 'github', glyph: '◇', label: 'GitHub' },
    ...sourceRegistry.entries().filter((source) => has(source.providerId, source.requiredCapability)).map(({ id, glyph, label }) => ({ id, glyph, label })),
  ]
}
