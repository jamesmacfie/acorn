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
