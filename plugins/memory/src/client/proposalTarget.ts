import { createSignal } from 'solid-js'
import { registerNoticeTargetHandler, setSelectedSource } from '@acorn/plugin-api/client'
import { MEMORY_SOURCE_ID } from '../shared/api'

export { MEMORY_SOURCE_ID }

// Where a "Review memory" row in the notification bell lands: the Memory page, on the proposal the
// row was about (docs/notifications.md § A notice is not an attention item).
//
// A signal rather than a route parameter. The page is a rail source and the shell draws from
// `selectedSource()` rather than the address bar, so there is no URL to carry the id in
// (client-core's sources.ts § sourceIdForPath). It is cleared as soon as the proposal is answered, so
// a later visit to the page opens with nothing picked.
const [highlightedProposal, setHighlightedProposal] = createSignal<string | undefined>()
export { highlightedProposal }
const [highlightedFinding, setHighlightedFinding] = createSignal<string | undefined>()
export { highlightedFinding }

export const clearHighlightedProposal = (): void => {
  setHighlightedProposal(undefined)
  setHighlightedFinding(undefined)
}

export function activateMemoryNoticeTargets(): void {
  // The per-proposal row from the attention inbox, which names one proposal. The node's proposal-gate
  // notice is about however many are waiting, so it targets the page through core's `source` kind
  // instead and never reaches this handler (../node/index.ts).
  registerNoticeTargetHandler('memory-proposal', (_taskId, target) => {
    setHighlightedProposal(target.resourceId || undefined)
    setSelectedSource(MEMORY_SOURCE_ID)
  })
  registerNoticeTargetHandler('findings-bundle', () => {
    setSelectedSource(MEMORY_SOURCE_ID)
  })
  registerNoticeTargetHandler('findings-candidate', (_taskId, target) => {
    setHighlightedFinding(target.resourceId || undefined)
    setSelectedSource(MEMORY_SOURCE_ID)
  })
}
