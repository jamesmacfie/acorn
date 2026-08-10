import { Registry } from './registry'
import { openPane } from './clientEvents'
import { paneContribution } from './panes'
import { openRefPanel } from './refPanels'

// Resolving an external URL in rendered content to somewhere INSIDE the app, so a link to
// github.com/o/r/pull/9 or linear.app/acme/issue/ENG-1 opens the pane instead of the browser.
//
// The registry and this type used to live in plugins/github/src/client/contentLinks.ts, together with
// the recogniser for LINEAR's URLs. github owned the seam, so a third provider could not participate
// in link resolution without a change to github — the shape finding 10 is about. The registry is core's
// now; each provider contributes the patterns it can recognise, from its own plugin.
//
// THE TARGET TYPE IS OPEN. It was `linear | pr | repo`, a closed union, which meant even after moving
// the registry a new provider could not express what it had found. `kind` is a plugin-owned string and
// the rest of the target belongs to whoever produced it; the handler that consumes one narrows on
// `kind`, and an unrecognised kind is simply not handled — the same shape the WS envelope uses
// (@acorn/protocol/ws.ts) and for the same reason.
export type InAppTarget = { kind: string } & Record<string, unknown>

export type ContentLinkContribution = {
  // Namespaced by convention, `<plugin>.<thing>` — 'github.pull-request', 'linear.issue'. It is what
  // the per-node plugin-disable test asserts against, and what makes an unclaimed kind traceable.
  id: string
  // Whose items these URLs identify, and the ONLY thing that makes a reference panel reachable from a
  // link: the ladder below looks the panel up by provider, never by a panel id a recogniser named.
  //
  // Bound to the registering plugin, on both tiers and by the host in both cases. A first-party plugin
  // going through `ctx.contribute` hits registries/plugin.ts § declaredProvider, which throws when a
  // plugin names a provider that is not its own; a manifest-declared recogniser never states it at all —
  // plugins/chrome/register.ts stamps the plugin id. Optional because a recogniser can legitimately have
  // no items of its own to show (github recognises PR and repo URLs and has no reference panel).
  providerId?: string
  parse: (href: string) => InAppTarget | null
}

export const contentLinkRegistry = new Registry<ContentLinkContribution>('content-link')

// First recogniser to claim the href wins. Order is the registry's declared order, so two providers
// whose patterns overlap resolve deterministically rather than by registration accident.
export function parseInAppTarget(href: string): InAppTarget | null {
  for (const contribution of contentLinkRegistry.entries()) {
    const claim = contribution.parse(href)
    if (!claim) continue
    // `providerId` is stamped LAST, so it is the registry's answer and not the recogniser's. `parse` is
    // plugin-supplied code returning an open record: left to itself it could claim `providerId: 'linear'`
    // and have the host open Linear's panel with a value Linear never saw. Overwriting here — including
    // with `undefined`, which is what a recogniser with no provider gets — is the cheapest place to hold
    // the line, because it is the one place that knows both the claim and who made it.
    return { ...claim, providerId: contribution.providerId }
  }
  return null
}

// Declarative recognisers carry the pane and selected item in their host-created target. Existing
// first-party targets do not, so this is additive and an unknown target still falls through to the
// browser.
//
// No active task means no pane to open, and this returns false. That is not a dead end: the same
// (pane, item) pair is addressable as `/t/:taskId?pane=…&item=…` (tasks/taskDeepLink.ts), so a caller
// holding a task id can navigate instead of calling this; a Source that contributed a route of its own can
// send the owner to its browse surface; and `openContentTarget` below falls to the provider's reference
// panel, which needs no task at all.
//
// This is now ONE RUNG of that ladder rather than the whole answer, and callers should prefer
// `openContentTarget`. It stays exported because it is the rung with the interesting invariant, and the
// suite that pins the invariant tests it directly.
export function openPluginContentTarget(target: InAppTarget, taskId: string | null | undefined): boolean {
  if (!taskId || typeof target.pane !== 'string' || typeof target.item !== 'string') return false
  // It has to be a registered TASK pane. Without this check, a target naming anything else — a plugin whose
  // surface is project-scoped, or one not installed on this device at all — would push its id into the
  // task's PERSISTED layout, where nothing can render it and it stays until the owner removes it by hand.
  // `parseTaskDeepLink` already applies exactly this check to the URL form of the same intent.
  if (!paneContribution(target.pane)) return false
  openPane(taskId, target.pane, { kind: 'plugin:select', item: target.item })
  return true
}

// The reference-panel rung. `item` is the captured value the recogniser named — an issue identifier, a card
// number — which is exactly a `displayId`; `providerId` is the stamp `parseInAppTarget` applied. Both have
// to be strings because a target is an open record, and `openRefPanel` still refuses a provider with no
// registered panel, so this cannot open an empty overlay.
function openRefPanelTarget(target: InAppTarget): boolean {
  const providerId = typeof target.providerId === 'string' ? target.providerId : ''
  const displayId = typeof target.item === 'string' ? target.item : ''
  return !!providerId && !!displayId && openRefPanel({ providerId, displayId })
}

// Every place a recognised link can land, named. It used to be a boolean, and a boolean is why
// `preventDefault` was easy to get wrong: plugins/github's handler called it once at the END, so every
// early `return` added on the way silently became "let the browser have it". Naming the outcomes makes the
// fall-through the one value a caller has to mention, instead of the default of any branch that forgets.
export type ContentLinkOutcome = 'refPanel' | 'pane' | 'external'

export type ContentLinkPresentation = {
  // The task whose layout a pane would open into. `null`/absent is normal, not an error: classic browse and
  // a rail source have no task, and the panel rung covers them.
  taskId?: string | null
  // Which presentation the CLICKING SURFACE would rather have — the surface knows, and the target does not.
  //
  // A PR conversation, or any panel already showing provider content, wants `refPanel`: the reader is
  // part-way through something and swapping the pane under them loses their place. A note or an agent
  // transcript leaves this alone and gets the pane, which is the richer view (linear's task pane shows
  // every ticket this task links, with the clicked one selected) and what those surfaces have always done.
  //
  // It is a preference and not a choice, because either rung can be unavailable: no task means no pane, and
  // an absent or disabled plugin means no panel. Whichever is asked for is tried first and the other is the
  // fallback, so a surface never has to know which of the two the target's plugin actually installed.
  prefer?: 'pane' | 'refPanel'
}

// The general ladder: what the HOST can do with a recognised target, in the order the surface asked for.
// It deliberately knows nothing plugin-specific — plugins/github wraps this with the two rungs that are
// genuinely its own (bare `CRA-404` text it linkified itself, and owner/name → project resolution), and
// every other content surface gets these two for free by calling `handlePluginContentLinkClick`.
export function openContentTarget(target: InAppTarget, presentation: ContentLinkPresentation = {}): ContentLinkOutcome {
  if (presentation.prefer === 'refPanel') {
    if (openRefPanelTarget(target)) return 'refPanel'
    return openPluginContentTarget(target, presentation.taskId) ? 'pane' : 'external'
  }
  if (openPluginContentTarget(target, presentation.taskId)) return 'pane'
  return openRefPanelTarget(target) ? 'refPanel' : 'external'
}

export function handlePluginContentLinkClick(event: MouseEvent, presentation: ContentLinkPresentation = {}): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  const anchor = (event.target as HTMLElement | null)?.closest('a') as HTMLAnchorElement | null
  const href = anchor?.getAttribute('href')
  if (!href) return false
  const target = parseInAppTarget(href)
  // An unrecognised URL, and a recognised one with nowhere in-app to go, are the same answer: the anchor
  // keeps its default and the real URL opens. Which is a FEATURE for the second case — see the deliberate
  // GitHub-repo-is-not-a-project fall-through in plugins/github/src/client/contentLinks.ts.
  if (!target || openContentTarget(target, presentation) === 'external') return false
  event.preventDefault()
  return true
}
