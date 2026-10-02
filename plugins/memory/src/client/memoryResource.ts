import { createResource, createSignal, type ResourceSource } from 'solid-js'

// Keep the library mounted on a failed refresh so errors stay visible beside the owner's draft.
export function createMemoryResource<S, T>(source: ResourceSource<S>, fetch: (source: S) => Promise<T>, fallback: T) {
  const [error, setError] = createSignal('')
  const [value, actions] = createResource(source, async (source) => {
    setError('')
    try { return await fetch(source) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load memory.') }
    return fallback
  }, { initialValue: fallback })
  return { value, error, ...actions }
}
