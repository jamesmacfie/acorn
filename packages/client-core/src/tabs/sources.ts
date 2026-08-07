// Source gating (docs/workspaces-and-tasks.md / docs/integrations.md): which browse Sources the rail shows.
// A source with a `providerId` (Linear, Rollbar) appears iff a connected integration row backs it; one
// without (GitHub, Docker, API, Agents) is always shown. Pure — unit tested; TabRail is the consumer.
//
// GitHub used to be PREPENDED here as a hardcoded literal, outside the registry, which is what made it the
// one Source the shell had to render itself. It is an ordinary contribution now (plugins/github's
// client/index.ts) and leads the rail because it declares the lowest `order` — not because of where its plugin
// sits in the list. Phase 3 shipped it the other way round (registration order, with a comment in
// apps/desktop/src/app/client/plugins.ts as the only statement of the rule), and that was the last registry on
// either side whose visible order depended on a declaration list.
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
    .filter((source) => !source.providerId || has(source.providerId, source.requiredCapability))
    // `id` breaks a tie, so two sources declaring the same order still produce a STABLE rail rather than one
    // that depends on registration after all — the same tiebreak the slot hosts use.
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(({ id, glyph, label }) => ({ id, glyph, label }))
}
