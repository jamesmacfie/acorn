import { createSignal, type Component } from 'solid-js'
import type { ExternalRef } from '@acorn/protocol/integrations.ts'
import { Registry } from './registry'
import { onScopeEvicted } from './scopeEviction'

// A ref a host can actually produce widens `ExternalRef` to make `connectionId` optional.
// docs/integrations.md explains why an identifier is not always attributed to one connection yet. A
// caller holding a full `ExternalRef` passes it through unchanged.
export type RefPanelTarget = Pick<ExternalRef, 'providerId' | 'displayId'> & Partial<Omit<ExternalRef, 'providerId' | 'displayId'>>

// Named `target`, never `ref`: Solid rewrites a component's `ref` prop into a callback
// (docs/architecture-overview.md § Package boundaries, "Two renderer traps"), so a props member
// called `ref` can never carry data across a JSX call site. This shipped once as a blank panel title
// with no `refId`, while every guard on the way in held. `tools/arch/boundaries.test.ts` holds the
// line for this directory.
export type RefPanelProps = {
  target: RefPanelTarget
  onClose: () => void
  // Clicks inside rendered provider markdown (a ticket body linking another ticket, a GitHub PR). The
  // host owns where a link goes, so the handler is passed down rather than resolved by the panel.
  onContentClick: (event: MouseEvent) => void
  // When a task links several items, the panel shows a chip strip to switch between them. Omitted by
  // single-ref hosts like PR detail.
  targets?: RefPanelTarget[]
  onSelectTarget?: (target: RefPanelTarget) => void
}

export type RefPanelContribution = {
  id: string
  // The provider whose items this panel renders. Bound to the registering plugin's own name by the
  // client plugin host (registries/plugin.ts § declaredProvider), so a plugin cannot claim another's
  // items.
  providerId: string
  // Per-node presence, the same predicate the pane registry takes. A panel whose plugin is stopped on
  // the node being looked at is not a destination: without this gate the click that named it was still
  // claimed, and `RefPanelHost` re-resolved to nothing and drew an empty overlay. Degrading at render
  // is not the same as declining, because declining is what lets the caller try the next rung.
  when?: () => boolean
  component: Component<RefPanelProps>
}

export const refPanelRegistry = new Registry<RefPanelContribution>('ref-panel')

// The panel for a ref's provider, or undefined when that plugin is disabled or absent, in which case a
// host should render nothing rather than fail. That degradation is the point of looking it up at
// render time instead of importing it.
export const refPanelFor = (providerId: string): RefPanelContribution | undefined =>
  refPanelRegistry.entries().find((entry) => entry.providerId === providerId && (!entry.when || entry.when()))

// The open panel is shell state, not a signal owned by whichever surface asked: one module-level
// signal here, one `RefPanelHost` mounted once by the composition root, and callers that only say what
// to show (docs/panes.md § Not a pane: the reference panel).
const [openRef, setOpenRef] = createSignal<RefPanelTarget | null>(null)

// The ref the host is currently showing, read by RefPanelHost and nothing else.
export const activeRefPanel = openRef

// Show a ref, or refuse (docs/panes.md § Not a pane: the reference panel). A false return is not a
// dead end: the caller's next rung (registries/contentLinks.ts) or the real browser URL is still
// there, which is why this reports rather than throws.
export function openRefPanel(ref: RefPanelTarget): boolean {
  if (!ref.providerId || !ref.displayId || !refPanelFor(ref.providerId)) return false
  setOpenRef(ref)
  return true
}

export const closeRefPanel = (): void => void setOpenRef(null)

// A panel is not keyed by node, so a node switch would leave the outgoing node's plugin frame on
// screen over the incoming one's shell (docs/state.md § Scope rules). Not cleared on task archival:
// the panel is not task-scoped, and a panel opened from a rail source has no task to lose.
onScopeEvicted((eviction) => {
  if (eviction.scope === 'node-switched') setOpenRef(null)
})
