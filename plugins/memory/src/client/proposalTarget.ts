import { createSignal } from 'solid-js'
import { registerNoticeTargetHandler, setSelectedSource } from '@acorn/plugin-api/client'
import { MEMORY_SOURCE_ID } from '../shared/api'

export { MEMORY_SOURCE_ID }

// Where a review notice lands: the Memory page, on its canonical candidate when one is named.
//
// A signal rather than a route parameter. The page is a rail source and the shell draws from
// `selectedSource()` rather than the address bar, so there is no URL to carry the id in
// (client-core's sources.ts § sourceIdForPath). It is cleared as soon as the proposal is answered, so
// a later visit to the page opens with nothing picked.
const [highlightedFinding, setHighlightedFinding] = createSignal<string | undefined>()
export { highlightedFinding }

export const clearHighlightedFinding = (): void => setHighlightedFinding(undefined)

export function activateMemoryNoticeTargets(): void {
  registerNoticeTargetHandler('findings-bundle', () => {
    setSelectedSource(MEMORY_SOURCE_ID)
  })
  registerNoticeTargetHandler('findings-candidate', (_taskId, target) => {
    setHighlightedFinding(target.resourceId || undefined)
    setSelectedSource(MEMORY_SOURCE_ID)
  })
}
