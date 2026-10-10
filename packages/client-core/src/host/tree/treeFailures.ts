import { createSignal } from 'solid-js'

// The last reason each remote contribution's tree failed, for Settings > Advanced > Extension points
// (docs/plugins/cooperative-extension-points.md § Seeing what matched).
//
// A failed tree draws nothing, so the owner's screen stays clean. That leaves an author with a blank
// box and no error, the same problem an unmatched contribution has. Keyed by contribution id, and
// kept for the session: a later good mount doesn't erase why the earlier one failed.

const [failures, setFailures] = createSignal<Readonly<Record<string, string>>>({})

export const recordTreeFailure = (contributionId: string, reason: string): void => {
  setFailures((current) => ({ ...current, [contributionId]: reason }))
}

export const treeFailure = (contributionId: string): string | undefined => failures()[contributionId]
