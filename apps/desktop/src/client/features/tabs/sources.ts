// Source gating (docs/workspaces 04 / docs/next 10): which browse Sources the rail shows.
// GitHub is always available; Linear/Rollbar appear iff a connected integration row exists.
// Pure — unit tested; TabRail is the consumer.
import type { Integration } from '../../../shared/api'
import type { SourceId } from '../tasks/tasks'

export type SourceEntry = { id: SourceId; glyph: string; label: string }

export function availableSources(integrations: Integration[] | undefined): SourceEntry[] {
  const has = (provider: string) => (integrations ?? []).some((i) => i.provider === provider && i.connected)
  return [
    { id: 'github', glyph: '◇', label: 'GitHub' },
    ...(has('linear') ? [{ id: 'linear' as const, glyph: '◷', label: 'Linear' }] : []),
    ...(has('rollbar') ? [{ id: 'rollbar' as const, glyph: '◍', label: 'Rollbar' }] : []),
  ]
}
