import { MAX_REF_RESOLVE_IDENTIFIERS, type PluginRefResolution } from '@acorn/protocol/refResolvers.ts'
import { Registry } from './registry'

// Turning identifiers of one plugin's items into something another plugin's surface can draw
// (docs/third-party/cross-plugin-refs.md § piece 2). The recognition half is ./contentLinks.ts; this is
// what happens after a ref has been found.
//
// The entry holds a CLOSURE rather than a route, exactly as `AgentContextContribution` does, and for
// the same reason: which node to ask, whether the plugin is running there, and the confinement re-check
// are all the registering host's business (plugins/chrome/register.ts binds them), and a consumer that
// knew about routes could address one the plugin never declared.
export type RefResolverContribution = {
  id: string
  // Bound to the registering plugin by the host, never read off a descriptor — the same rule as a
  // content-link recogniser's stamp. It is what a consumer addresses a resolver BY.
  providerId: string
  // The content-link kind these identifiers come from ('linear.issue'), so a surface that scanned text
  // can tell which of a plugin's resolvers its refs belong to. Unused while every plugin declares one.
  kind: string
  resolve: (identifiers: readonly string[]) => Promise<PluginRefResolution[]>
}

export const refResolverRegistry = new Registry<RefResolverContribution>('ref resolver')

// The resolver for a provider, or undefined when that plugin is absent or stopped here — in which case
// the caller renders the plain identifier, which is what it had before asking. Looked up at call time
// rather than imported, so a mid-session disable degrades instead of failing (./refPanels.ts § refPanelFor
// makes the same argument for the panel half).
export const refResolverFor = (providerId: string): RefResolverContribution | undefined =>
  refResolverRegistry.entries().find((entry) => entry.providerId === providerId)

// One TanStack options factory for every provider. Five-minute staleness is inherited from the linear
// import this replaced, and is a HOST policy now: a resolver answers about someone else's tracker, where
// a title changing within the minute is not worth a request per surface per mount.
//
// The key includes the sorted identifier set, so two surfaces citing the same tickets in a different
// order share one cache entry. NOTE the persisted-cache rule (docs/architecture-overview.md): the query
// cache survives in IndexedDB with no buster, so if `PluginRefResolution` ever gains a required field
// this key string has to change with it.
export const refResolutionsOptions = (providerId: string, identifiers: readonly string[], enabled = true) => {
  const wanted = [...new Set(identifiers)].sort()
  return {
    queryKey: ['plugin-ref-resolutions', providerId, ...wanted] as const,
    enabled: enabled && wanted.length > 0 && !!refResolverFor(providerId),
    staleTime: 5 * 60 * 1000,
    // Always re-check on mount so a list self-heals from a stale or empty persisted cache.
    refetchOnMount: 'always' as const,
    queryFn: async (): Promise<PluginRefResolution[]> =>
      (await refResolverFor(providerId)?.resolve(wanted.slice(0, MAX_REF_RESOLVE_IDENTIFIERS))) ?? [],
  }
}
