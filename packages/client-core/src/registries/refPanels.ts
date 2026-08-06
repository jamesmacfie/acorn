// Detail panels for an external item (a Linear ticket, a Rollbar occurrence), contributed by the plugin
// that owns the provider and rendered by whoever holds a reference to one.
//
// It exists for one host and one contributor, and that is deliberate rather than an oversight, so the
// reasoning is worth stating instead of leaving a reader to wonder whether it is over-built:
//
//   plugins/github's PR detail scans PR bodies, comments and reviews for referenced tickets and opens a
//   panel when the user clicks one. It did that by importing plugins/linear's `LinearIssuePanel` — the last
//   plugin→plugin edge on the boundary ledger. The problem is not the indirection's cost, it is that
//   github has no business NAMING a provider plugin: a PR body can reference any provider's item, and the
//   plugin that reviews pull requests should not gain a dependency for each one.
//
// So the seam is keyed on `providerId` and github asks "who renders this ref?". Today exactly linear
// answers. plugins/rollbar deliberately does NOT register: its panel is rendered only by its own pane and
// browse view, so a registration would be a contribution with no host — the same speculative machinery
// Phase 2 deleted the NodeEventBus for.
//
// JSX-free, per registries/slots.ts: registries/plugin.ts must stay importable in a bare-Node vitest run.
import type { Component } from 'solid-js'
import type { ExternalRef } from '@acorn/protocol/integrations.ts'
import { Registry } from './registry'

// A ref a host can actually produce. `ExternalRef` — what `PaneIntent`'s `integration:show-ref` carries and
// what `task_links` resolves to — requires a `connectionId`, and the host this registry exists for does not
// have one: PR detail finds a ticket by scanning text, and which of several connected Linear workspaces owns
// it is resolved server-side (plugins/github's own comment says the same about seeding a task link, where it
// only attributes a ref when there is exactly ONE Linear connection).
//
// So the target widens ExternalRef's two identifying fields and makes the rest optional, rather than making
// the host invent a connection it cannot know. A caller that HAS a full ExternalRef — a task link, a pane
// intent — passes it through unchanged.
export type RefPanelTarget = Pick<ExternalRef, 'providerId' | 'displayId'> & Partial<Omit<ExternalRef, 'providerId' | 'displayId'>>

export type RefPanelProps = {
  ref: RefPanelTarget
  onClose: () => void
  // Clicks inside rendered provider markdown (a ticket body linking another ticket, or a GitHub PR). The
  // HOST owns where a link goes — github routes PR links into the SPA — so the handler is passed down
  // rather than resolved by the panel.
  onContentClick: (event: MouseEvent) => void
  // When a task links several items, the panel shows a chip strip to switch between them. Omitted by
  // single-ref hosts like PR detail.
  refs?: RefPanelTarget[]
  onSelectRef?: (ref: RefPanelTarget) => void
}

export type RefPanelContribution = {
  id: string
  // The provider whose items this panel renders. Bound to the registering plugin's own name by the client
  // plugin host (registries/plugin.ts § declaredProvider), so a plugin cannot claim another's items.
  providerId: string
  component: Component<RefPanelProps>
}

export const refPanelRegistry = new Registry<RefPanelContribution>('ref-panel')

// The panel for a ref's provider, or undefined when that plugin is disabled or absent — in which case a
// host should render nothing rather than fail. That degradation is the point of looking it up at render
// time instead of importing it.
export const refPanelFor = (providerId: string): RefPanelContribution | undefined =>
  refPanelRegistry.entries().find((entry) => entry.providerId === providerId)
