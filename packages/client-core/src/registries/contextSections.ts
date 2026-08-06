// Extra UI a plugin renders INSIDE a context-pane section (docs/vNext/plugins.md § ClientPluginContext).
//
// plugins.md names `contextSections` on the client context; Phase 2 left it out for having no consumer, and
// this is that consumer. plugins/context's pane rendered `<MemorySection>` by importing plugins/memory
// directly, which was the `context -> memory` coupling edge and also the reason plugins/memory had no
// ClientPlugin at all: it had client code but nothing registrable.
//
// The node-side registry is a different thing with a similar name, and the split is deliberate: there, a
// contribution supplies a section's DATA (server/agentTools/contextSections.ts). Here it supplies extra
// controls rendered under a section the node already returned. Memory's section is the only one with any —
// the add-memory form and the pending-proposal count — and every other section renders from its items
// alone.
//
// Kept JSX-free for the reason registries/slots.ts states: registries/plugin.ts must stay importable in a
// bare-Node vitest run, and a module that reaches a `.tsx` file cannot be.
import type { Component } from 'solid-js'
import type { Task } from '../queries'
import { Registry } from './registry'

export type ContextSectionSlotProps = {
  task: Task
  // Re-fetch the assembled context. A contribution that MUTATES what a section reports (memory's
  // add/accept/reject) has to invalidate the inventory the pane is rendering, and only the pane owns that
  // fetch — hence a callback rather than the contribution reaching for the query itself.
  onChanged: () => void
  // How many not-yet-resolved items this contribution is holding, shown in the section header. Reported
  // upward rather than read downward because the count lives in the contribution's own state.
  onPendingChange: (count: number) => void
}

export type ContextSectionContribution = {
  id: string
  // Which node-side section this renders under, by that section's id ('memory', 'pr', 'notes', 'issues').
  // Not the same field as `id`: a section could host more than one contribution, and each still needs its
  // own registry key.
  sectionId: string
  order: number
  component: Component<ContextSectionSlotProps>
}

export const contextSectionRegistry = new Registry<ContextSectionContribution>('context-section')

// Sorted by `order`, so registration order — and therefore plugin declaration order — cannot affect what
// the pane renders. Same rule the pane, settings and slot registries follow.
export const contextSectionContributions = (sectionId: string): readonly ContextSectionContribution[] =>
  contextSectionRegistry
    .entries()
    .filter((entry) => entry.sectionId === sectionId)
    .sort((a, b) => a.order - b.order)
