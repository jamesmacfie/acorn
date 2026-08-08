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
    for (const id of ['linear', 'rollbar']) {
      disposables.push(sourceRegistry.register({
        id, order: id === 'linear' ? 20 : 30, providerId: id, glyph: id === 'linear' ? '◷' : '◍', label: id === 'linear' ? 'Linear' : 'Rollbar',
        promotion: {
          canPromote: () => true,
          prepare: async () => ({ origin: id, projectId: 'project-1', branch: 'main' }),
          create: async (seed) => ({
            ...seed,
            id: 'task', title: seed.title ?? 'Task', icon: seed.icon ?? null, worktreePath: null, pullNumber: seed.pullNumber ?? null,
            status: 'active', parentId: null, sort: 0, links: [],
            github: { owner: 'acme', name: 'widget' }, branch: seed.branch ?? null,
          }),
        },
      }))
    }
    disposables.push(sourceRegistry.register({ id: 'github', order: 10, glyph: '◇', label: 'GitHub', providerId: 'github' }))
  })
  afterAll(() => disposables.forEach((disposable) => disposable.dispose()))

  it('local sources (no providerId) are always shown', () => {
    const local = sourceRegistry.register({
      id: 'docker-test', order: 40, glyph: '◧', label: 'Docker',
    })
    try {
      expect(availableSources(undefined).map((s) => s.id)).toContain('docker-test')
      expect(availableSources([]).map((s) => s.id)).toContain('docker-test')
    } finally {
      local.dispose()
    }
  })

  it('provider sources appear only when their integration is connected', () => {
    expect(availableSources(undefined).map((s) => s.id)).toEqual([])
    expect(availableSources([integration('github')]).map((s) => s.id)).toEqual(['github'])
    expect(availableSources([integration('linear')]).map((s) => s.id)).toEqual(['linear'])
    expect(availableSources([integration('github'), integration('linear'), integration('rollbar')]).map((s) => s.id)).toEqual(['github', 'linear', 'rollbar'])
    expect(availableSources([integration('github', false)]).map((s) => s.id)).toEqual([])
  })

  // The rail's order comes from the declared `order`, not from when a plugin happened to register.
  //
  // This exercises the full registry independently of provider availability, so every gated source is
  // visible and its declared order is checked directly.
  it('orders the rail by the declared order, whatever the registration order was', () => {
    const late = sourceRegistry.register({ id: 'aardvark', order: 999, glyph: 'a', label: 'Aardvark' })
    const early = sourceRegistry.register({ id: 'zebra', order: 1, glyph: 'z', label: 'Zebra' })
    try {
      // 'zebra' registered last with order 1 leads; 'aardvark' registered first with order 999 trails. Under
      // registration order this would read aardvark, linear, rollbar, github, zebra — and alphabetically it
      // would read aardvark first too, so neither fallback can produce this answer.
      expect(availableSources([integration('github'), integration('linear'), integration('rollbar')]).map((s) => s.id)).toEqual(['zebra', 'github', 'linear', 'rollbar', 'aardvark'])
    } finally {
      late.dispose()
      early.dispose()
    }
  })

  // `when` is the second, independent gate. Fleet home is its one contributor: docs/ui-design.md says the view "stays
  // out of the way" with a single node, and first-run must never mention nodes at all — so the rail button
  // has to be absent, not present-and-empty.
  it('honours `when` independently of providerId', () => {
    let visible = false
    const gated = sourceRegistry.register({ id: 'when-test', order: 0, glyph: 'w', label: 'When', when: () => visible })
    try {
      expect(availableSources(undefined).map((s) => s.id)).toEqual([])
      visible = true
      expect(availableSources(undefined).map((s) => s.id)).toEqual(['when-test'])
    } finally {
      gated.dispose()
    }
  })

  it('AND-s `when` with the provider gate rather than replacing it', () => {
    // A source with both must satisfy both — otherwise adding `when` would have quietly opened a hole in
    // the integration gate for any contribution that declared one.
    const both = sourceRegistry.register({
      id: 'both-test', order: 0, glyph: 'b', label: 'Both', providerId: 'linear', when: () => false,
    })
    try {
      expect(availableSources([integration('linear')]).map((s) => s.id)).not.toContain('both-test')
    } finally {
      both.dispose()
    }
  })

  it('breaks an order tie by id, so equal orders still give a stable rail', () => {
    const b = sourceRegistry.register({ id: 'b-source', order: 5, glyph: 'b', label: 'B' })
    const a = sourceRegistry.register({ id: 'a-source', order: 5, glyph: 'a', label: 'A' })
    try {
      // Registered b then a; the tiebreak puts a first, so the answer does not depend on registration.
      expect(availableSources(undefined).map((s) => s.id)).toEqual(['a-source', 'b-source'])
    } finally {
      a.dispose()
      b.dispose()
    }
  })
})
