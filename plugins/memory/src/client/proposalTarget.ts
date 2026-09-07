import { createSignal } from 'solid-js'
import { registerNoticeTargetHandler, setSelectedSource } from '@acorn/plugin-api/client'

// Where a "Review memory" row in the notification bell lands: the Memory page, on the proposal the
// row was about (docs/notifications.md § A notice is not an attention item).
//
// A signal rather than a route parameter. The page is a rail source and the shell draws from
// `selectedSource()` rather than the address bar, so there is no URL to carry the id in
// (client-core's sources.ts § sourceIdForPath). It is cleared as soon as the proposal is answered, so
// a later visit to the page opens with nothing picked.
const [highlightedProposal, setHighlightedProposal] = createSignal<string | undefined>()
export { highlightedProposal }

export const clearHighlightedProposal = (): void => setHighlightedProposal(undefined)

export const MEMORY_SOURCE_ID = 'memory'

export function activateMemoryNoticeTargets(): void {
  registerNoticeTargetHandler('memory-proposal', (_taskId, target) => {
    setHighlightedProposal(target.resourceId)
    setSelectedSource(MEMORY_SOURCE_ID)
  })
}
