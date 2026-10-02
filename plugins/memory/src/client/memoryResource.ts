import { createResource, createSignal, type ResourceSource } from 'solid-js'

// Keep the library mounted on a failed refresh so errors stay visible beside the owner's draft.
// `loaded` turns true after the first read answers, so a view can tell "empty" from "not asked yet".
export function createMemoryResource<S, T>(source: ResourceSource<S>, fetch: (source: S) => Promise<T>, fallback: T) {
  const [error, setError] = createSignal('')
  const [loaded, setLoaded] = createSignal(false)
  const [value, actions] = createResource(source, async (source) => {
    setError('')
    try { return await fetch(source) }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load memory.") }
    finally { setLoaded(true) }
    return fallback
  }, { initialValue: fallback })
  return { value, error, loaded, ...actions }
}
