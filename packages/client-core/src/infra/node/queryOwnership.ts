import type { QueryClient } from '@tanstack/solid-query'

// Partition identity outlives the mounted provider. Deferred writes and teardown keep this identity
// even after selection changes. Null identifies the browser's serving origin, not an ambient target.
const owners = new WeakMap<QueryClient, string | null>()

export const registerQueryOwner = (client: QueryClient, nodeId: string | null): void => {
  owners.set(client, nodeId)
}

export const queryOwner = (client: QueryClient): string | null | undefined => owners.get(client)
