import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Integration } from '@acorn/protocol/api.ts'
import { availableSources } from './sources'
import { sourceRegistry } from '../registries/sources'

const integration = (providerId: string, connected = true): Integration => ({
  id: providerId,
  providerId,
  label: providerId,
  status: connected ? 'connected' : 'disabled',
  authKind: 'api-key',
  account: null,
  scopes: [],
  capabilities: { browse: 'available' },
  createdAt: 0,
  updatedAt: 0,
})

describe('availableSources (docs/integrations.md — gated by integration rows)', () => {
  const disposables: { dispose(): void }[] = []
  beforeAll(() => {
    // github is a REGISTERED source as of Phase 3, not a hardcoded literal inside availableSources, so the
    // fixture has to register it like any other. It carries no `providerId` (it must be visible before GitHub
    // is connected) and no `promotion` (its browse creates tasks inline), which is exactly the real
    // contribution's shape — and registering it FIRST is what puts it at the head of the rail, since this
    // registry's order is registration order.
    disposables.push(sourceRegistry.register({ id: 'github', glyph: '◇', label: 'GitHub' }))
    for (const id of ['linear', 'rollbar']) {
      disposables.push(sourceRegistry.register({
        id, providerId: id, glyph: id === 'linear' ? '◷' : '◍', label: id === 'linear' ? 'Linear' : 'Rollbar',
        promotion: {
          canPromote: () => true,
          prepare: async () => ({ origin: id, repoOwner: 'acme', repoName: 'widget', branch: 'main' }),
          create: async (seed) => ({
            ...seed,
            id: 'task', title: seed.title ?? 'Task', icon: seed.icon ?? null, worktreePath: null, pullNumber: seed.pullNumber ?? null,
            status: 'active', parentId: null, sort: 0, links: [],
          }),
        },
      }))
    }
  })
  afterAll(() => disposables.forEach((disposable) => disposable.dispose()))

  it('local sources (no providerId) are always shown', () => {
    const local = sourceRegistry.register({
      id: 'docker-test', glyph: '◧', label: 'Docker',
    })
    try {
      expect(availableSources(undefined).map((s) => s.id)).toContain('docker-test')
      expect(availableSources([]).map((s) => s.id)).toContain('docker-test')
    } finally {
      local.dispose()
    }
  })

  it('an ungated source is always shown; Linear/Rollbar appear iff connected', () => {
    expect(availableSources(undefined).map((s) => s.id)).toEqual(['github'])
    expect(availableSources([integration('linear')]).map((s) => s.id)).toEqual(['github', 'linear'])
    expect(availableSources([integration('rollbar')]).map((s) => s.id)).toEqual(['github', 'rollbar'])
    expect(availableSources([integration('linear'), integration('rollbar')]).map((s) => s.id)).toEqual(['github', 'linear', 'rollbar'])
    expect(availableSources([integration('rollbar', false)]).map((s) => s.id)).toEqual(['github'])
  })
})
