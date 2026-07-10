import { describe, expect, it } from 'vitest'
import '../../../app/server/providers'
import { integrationProviderRegistry } from './registry'

describe('integration provider conformance', () => {
  for (const provider of integrationProviderRegistry.list()) {
    describe(provider.id, () => {
      it('publishes descriptor metadata without secret material', () => {
        const publicJson = JSON.stringify(provider.toPublic())
        expect(publicJson).not.toMatch(/authRef|accessToken|refreshToken|secret/i)
        expect(provider.budgets.maxConcurrentRequests).toBeGreaterThan(0)
        expect(provider.budgets.maxConcurrentRequestsPerConnection).toBeGreaterThan(0)
        expect(provider.budgets.maxCachedItemBytes).toBeGreaterThan(0)
        expect(provider.memory.acceptedWrites).toBe(false)
      })

      it('fulfills every declared capability obligation', () => {
        if (provider.capabilities.comments === 'write') {
          expect(provider.mutations?.some((mutation) => mutation.capability === 'comments' && mutation.invalidates.length > 0)).toBe(true)
        }
        if (provider.capabilities.contextFormat) {
          expect(provider.codec).toBeDefined()
          expect(provider.taskContext).toBeDefined()
        }
        if (provider.capabilities.browse) expect(provider.resources.length).toBeGreaterThan(0)
        for (const resource of provider.resources) {
          expect(resource.ttlMs).toBeGreaterThan(0)
          expect(resource.key).toBeTypeOf('function')
          expect(resource.read).toBeTypeOf('function')
          expect(resource.refresh).toBeTypeOf('function')
        }
        const ref = provider.externalIds.fromDisplay(`${provider.id}-connection`, 'ITEM-1')
        expect(provider.externalIds.parse(ref, ref)).toEqual(ref)
        expect(provider.externalIds.parse({ ...ref, providerId: 'forged' }, ref)).toBeNull()
      })

      if (provider.kind !== 'identity') {
        it('projects a provider-owned HTTP router without core route wiring', () => {
          expect(integrationProviderRegistry.routes().some((route) => route.providerId === provider.id)).toBe(true)
        })
      }

      if (provider.codec && provider.conformance) {
        it('migrates old cache, rejects malformed cache, and preserves detail on list refresh', () => {
          const old = provider.codec!.parse(provider.conformance!.legacyCache, provider.conformance!.ref)
          expect(old.ok).toBe(true)
          if (!old.ok) return
          expect(old.migrated).toBe(true)
          expect(provider.codec!.parse({ obsolete: true }, provider.conformance!.ref).ok).toBe(false)

          const detailed = provider.conformance!.detail === undefined
            ? old.value
            : provider.codec!.withDetail(provider.conformance!.ref, provider.conformance!.summary, provider.conformance!.detail, 10)
          const refreshed = provider.codec!.mergeSummary(detailed, provider.conformance!.ref, provider.conformance!.summary, 20)
          expect(refreshed.detail).toEqual(detailed.detail)
          expect(refreshed.listFetchedAt).toBe(20)
        })

        it('formats every cache degradation state without throwing', () => {
          const formatter = provider.taskContext!
          for (const state of ['missing', 'malformed', 'stale', 'deleted'] as const) {
            expect(() => formatter.summarize(provider.conformance!.ref, null, state)).not.toThrow()
          }
        })
      }
    })
  }
})
