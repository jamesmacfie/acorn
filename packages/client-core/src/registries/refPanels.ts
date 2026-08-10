import { createSignal, type Component } from 'solid-js'
import type { ExternalRef } from '@acorn/protocol/integrations.ts'
import { Registry } from './registry'
import { onScopeEvicted } from './scopeEviction'

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

// ── The presentation: one panel at a time, owned by the shell ─────────────────────────────────────
//
// The registry above was already general, and the INVOCATION was not. plugins/github's PR detail held a
// `createSignal<string | null>` of its own and rendered `refPanelFor('linear')` beside the conversation,
// which meant exactly one surface in the app could open exactly one plugin's panel. Anything else that
// renders provider content — a note, an agent transcript, another plugin's pane — had no way to show a
// referenced item at all, even though the registry would have served it.
//
// So the open panel becomes shell state, the same shape `willPhase.tsx` uses for a confirmation: a
// module-level signal here, one `RefPanelHost` mounted once by the composition root (./refPanelHost.tsx),
// and callers that only say WHAT to show.
//
// Single-slot on purpose. A reference panel is a "look at this without leaving where you are" affordance;
// two of them stacked is a navigation history, which is what panes and routes are for. Opening a second
// replaces the first — which is also what a ticket linking another ticket should do.
const [openRef, setOpenRef] = createSignal<RefPanelTarget | null>(null)

// The ref the host is currently showing, read by RefPanelHost and nothing else.
export const activeRefPanel = openRef

// Show a ref, or refuse. Refusing is the whole reason this is a function and not a setter: `providerId` on
// the way in is a CLAIM — it arrives from a plugin-supplied content-link recogniser, or from another
// plugin naming a provider it does not own — and a panel that no registered contribution can render would
// put the shell into a state with no dismiss affordance and nothing inside it. Same line
// `openPluginContentTarget` holds for task panes, for the same reason.
//
// A false return is not a dead end: the caller's next rung (registries/contentLinks.ts) or the real
// browser URL is still there, which is why this reports rather than throws.
export function openRefPanel(ref: RefPanelTarget): boolean {
  if (!ref.providerId || !ref.displayId || !refPanelFor(ref.providerId)) return false
  setOpenRef(ref)
  return true
}

export const closeRefPanel = (): void => void setOpenRef(null)

// A panel is not keyed by node, so a switch would leave the outgoing node's plugin frame on screen over
// the incoming node's shell — the failure class registries/scopeEviction.ts exists to prevent. Registered
// beside the signal it clears, as that file asks. NOT cleared on task archival: the panel is not
// task-scoped, and a panel opened from a rail source has no task to lose.
onScopeEvicted((eviction) => {
  if (eviction.scope === 'node-switched') setOpenRef(null)
})
