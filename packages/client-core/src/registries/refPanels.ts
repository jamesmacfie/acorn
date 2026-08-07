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
