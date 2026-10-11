import type { SearchBridge } from './routes/search'
import type { SearchCoreServices } from './search'

/** Keep ripgrep, its parser, and folder-search work off the Node boot graph. */
export function lazySearchBridge(core: SearchCoreServices): SearchBridge {
  let loaded: Promise<SearchBridge> | undefined
  const bridge = () => (loaded ??= import('./search').then(({ searchBridge }) => searchBridge(core)))
  return { findInFiles: (...args) => bridge().then((owner) => owner.findInFiles(...args)) }
}
