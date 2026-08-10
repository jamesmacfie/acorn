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

// NOT named `ref`, and that is load-bearing rather than a style preference. `ref` is a RESERVED JSX
// attribute: Solid's compiler sees `ref={value}` on a component and emits a `ref(r$)` METHOD that
// assigns `r$` back into whatever was passed, because on an element that is how you capture the DOM
// node. So a props member called `ref` can never carry data across a JSX call site — the panel receives
// a function where it expected a target, `props.ref.displayId` reads `undefined`, and nothing anywhere
// errors. That is exactly what shipped: the host header drew a blank title and the frame was handed no
// `refId`, so linear's panel opened onto its "pick an issue" empty state while every guard on the way
// in (`openRefPanel`, `openRefPanelTarget`) held perfectly. The only correct `ref` prop is a callback,
// and tools/arch/boundaries.test.ts now holds that line for this whole directory.
export type RefPanelProps = {
  target: RefPanelTarget
  onClose: () => void
  // Clicks inside rendered provider markdown (a ticket body linking another ticket, or a GitHub PR). The
  // HOST owns where a link goes — github routes PR links into the SPA — so the handler is passed down
  // rather than resolved by the panel.
  onContentClick: (event: MouseEvent) => void
  // When a task links several items, the panel shows a chip strip to switch between them. Omitted by
  // single-ref hosts like PR detail.
  targets?: RefPanelTarget[]
  onSelectTarget?: (target: RefPanelTarget) => void
}

export type RefPanelContribution = {
  id: string
  // The provider whose items this panel renders. Bound to the registering plugin's own name by the client
  // plugin host (registries/plugin.ts § declaredProvider), so a plugin cannot claim another's items.
  providerId: string
  // Per-node presence, the same predicate the pane registry takes (plugins/frames/register.tsx). A panel
  // whose plugin is installed but stopped on the node being looked at is not a destination, and without
  // this the click that named it was still CLAIMED — `openRefPanel` said yes, the shell put a target in
  // its single slot, and `RefPanelHost` re-resolved to nothing and drew an empty overlay. Degrading at
  // render is not the same as declining, because declining is what lets the caller try the next rung.
  when?: () => boolean
  component: Component<RefPanelProps>
}

export const refPanelRegistry = new Registry<RefPanelContribution>('ref-panel')

// The panel for a ref's provider, or undefined when that plugin is disabled or absent — in which case a
// host should render nothing rather than fail. That degradation is the point of looking it up at render
// time instead of importing it.
export const refPanelFor = (providerId: string): RefPanelContribution | undefined =>
  refPanelRegistry.entries().find((entry) => entry.providerId === providerId && (!entry.when || entry.when()))

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
