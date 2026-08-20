import { Registry } from './registry'
import { openPane } from './clientEvents'
import { paneAvailable, paneContribution } from './panes'
import { openRefPanel } from './refPanels'
import { sourceIdForPath } from './sources'
import { taskById } from '../tasks/taskLookup'
import { setSelectedSource } from '../tasks/tasks'

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
  // The ROUTE this target has inside the app, when it has one. The two rungs below open something —
  // a task pane, a reference panel — and a Source whose detail is a project-scoped route has neither:
  // github's PR view is a whole surface at `/p/:projectId/pulls/:number`, not a card to glance at.
  //
  // Plugin-owned because the resolution is: owner/name → project is a question only github can ask,
  // and it needs the project list (projects/projectLookup.ts). Optional, and returning null is normal
  // — a URL for a repo acorn does not track has no in-app destination and must keep going to the
  // browser, which is the deliberate fall-through plugins/github/src/client/contentLinks.ts documents.
  path?: (target: InAppTarget) => string | null
}

export const contentLinkRegistry = new Registry<ContentLinkContribution>('content-link')

// First recogniser to claim the href wins. Order is the registry's declared order, so two providers
// whose patterns overlap resolve deterministically rather than by registration accident.
//
// Both the target and WHO claimed it, because the contribution carries the route resolver too and a URL
// must not be able to resolve to one provider's target and another's path.
function claimFor(href: string): { target: InAppTarget; contribution: ContentLinkContribution } | null {
  for (const contribution of contentLinkRegistry.entries()) {
    const claim = contribution.parse(href)
    if (!claim) continue
    // `providerId` is stamped LAST, so it is the registry's answer and not the recogniser's. `parse` is
    // plugin-supplied code returning an open record: left to itself it could claim `providerId: 'linear'`
    // and have the host open Linear's panel with a value Linear never saw. Overwriting here — including
    // with `undefined`, which is what a recogniser with no provider gets — is the cheapest place to hold
    // the line, because it is the one place that knows both the claim and who made it.
    return { target: { ...claim, providerId: contribution.providerId }, contribution }
  }
  return null
}

export function parseInAppTarget(href: string): InAppTarget | null {
  return claimFor(href)?.target ?? null
}

/** The in-app route for an external URL, or null when it has none. */
export function inAppPathFor(href: string): string | null {
  const claim = claimFor(href)
  return claim ? claim.contribution.path?.(claim.target) ?? null : null
}

// ── Extraction: every plugin's recognised URLs out of a body of text ──────────────────────────────
//
// The other half of recognition. `parseInAppTarget` answers "what is this href", which is what a CLICK
// needs; a surface rendering someone else's prose needs "what does this text reference at all" —
// plugins/github's PR body and list, and in principle notes and agent transcripts. That question used
// to be answered by importing `scanLinearRefs` from @acorn/plugin-linear/contract, which is a
// cross-plugin import that stops working the day either side is a loaded package, and which could only
// ever find Linear.
//
// It scans for CANDIDATES and hands each to the registry, rather than compiling the declared patterns
// into a matcher of its own. Three reasons, and the third is the one that decided it:
//   - a `ContentLinkContribution` carries a `parse` FUNCTION, not a pattern. First-party recognisers
//     (github's own PR and repo regexes) declare no pattern at all, so a pattern-compiling scanner
//     would be structurally blind to them;
//   - the provider stamp, the first-claim-wins order and the bounded host/path grammar are already
//     applied by `parseInAppTarget`, and a second matcher is a second thing to disagree with it;
//   - the registry mutates as plugins start and stop, and nothing cached here means nothing to
//     invalidate.
//
// Linear-time by construction: one pass for candidates, then one bounded grammar match each.
export type ContentRef = {
  // The stamp `parseInAppTarget` applied. Absent for a recogniser with no items of its own to show.
  providerId?: string
  kind: string
  item: string
  url: string
}

// https only, because `compileContentLinkPattern` refuses every other scheme at compile time. The class
// stops at whitespace and at the delimiters that surround a URL in the two shapes this reads — HTML
// attributes and markdown links — rather than trying to know URL syntax.
const URL_CANDIDATE = /https:\/\/[^\s<>"'`)\]]+/g
// Prose ends sentences. A trailing full stop or comma is punctuation, never part of the URL here.
const TRAILING_PUNCTUATION = /[.,;:!?]+$/
// A body is arbitrary text from a third party. The cap is far above any real PR conversation and keeps
// a pathological one from occupying the renderer.
const MAX_CANDIDATES = 256

export function scanContentRefs(texts: (string | null | undefined)[]): ContentRef[] {
  const found = new Map<string, ContentRef>()
  let scanned = 0
  for (const text of texts) {
    if (!text) continue
    URL_CANDIDATE.lastIndex = 0
    for (const match of text.matchAll(URL_CANDIDATE)) {
      if (++scanned > MAX_CANDIDATES) return [...found.values()]
      const url = match[0].replace(TRAILING_PUNCTUATION, '')
      const target = parseInAppTarget(url)
      // A recogniser that captured no item identifies nothing to enrich or link — github's `repo` target
      // is exactly that. It is still a valid click destination, just not a reference.
      if (!target || typeof target.item !== 'string' || !target.item) continue
      // Deduped by WHAT is referenced rather than by URL, so linear.app/…/issue/ENG-1 and the same issue
      // with a title slug appended are one ref. First URL wins; insertion order is the reading order.
      const key = `${target.providerId ?? ''} ${target.item}`
      if (found.has(key)) continue
      found.set(key, {
        ...(typeof target.providerId === 'string' ? { providerId: target.providerId } : {}),
        kind: target.kind,
        item: target.item,
        url,
      })
    }
  }
  return [...found.values()]
}

// ── Bare tokens: `CRA-404` with no URL around it ──────────────────────────────────────────────────
//
// Everything above needs a URL. People do not write URLs — a PR title says `CRA-404`, and github used
// to own the machinery that made those clickable, learning the prefixes from Linear refs it had already
// found in the same body. The trick was right and the ownership was wrong: it only ever worked for
// Linear, and it lived in the plugin that CONSUMES the reference rather than in the host.
//
// The safety argument is the learning step, and it is the reason there is no manifest field here. A
// bare token is ambiguous — `ABC-123` could be anyone's — so nothing licenses one except a ref of the
// same prefix already CONFIRMED in the same surface, by a URL the owning plugin's own recogniser
// claimed. The prefix was witnessed, so there is no ambiguity to resolve; the shape is host-owned, so
// there is no pattern language to review. A plugin declaring `{prefix}-{num}` cold, with no witness,
// is a different and later design (git history: docs/third-party/cross-plugin-refs.md § piece 3 v2) that must not
// ship before candidates can be confirmed against a resolver.
const BARE_REF_SHAPE = /^([A-Z][A-Z0-9]*)-\d+$/

/** PREFIX → the provider whose confirmed ref licensed it. First witness wins, so a second provider
 * cannot take over a prefix by appearing later in the same text. */
export function learnRefPrefixes(refs: readonly ContentRef[]): Map<string, string> {
  const prefixes = new Map<string, string>()
  for (const ref of refs) {
    if (!ref.providerId) continue
    const match = BARE_REF_SHAPE.exec(ref.item)
    if (match && !prefixes.has(match[1])) prefixes.set(match[1], ref.providerId)
  }
  return prefixes
}

export type RefTokenPart = { text: string; ref?: { providerId: string; item: string } }

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Split text into plain runs and licensed bare refs, for a surface that renders its own text nodes. */
export function splitRefTokens(text: string, prefixes: ReadonlyMap<string, string>): RefTokenPart[] {
  if (!prefixes.size) return [{ text }]
  const pattern = new RegExp(`\\b(?:${[...prefixes.keys()].map(escapeRegExp).join('|')})-\\d+\\b`, 'g')
  const parts: RefTokenPart[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ text: text.slice(last, index) })
    const providerId = prefixes.get(match[0].slice(0, match[0].lastIndexOf('-')))
    parts.push(providerId ? { text: match[0], ref: { providerId, item: match[0] } } : { text: match[0] })
    last = index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts.length ? parts : [{ text }]
}

// The class the host styles these with (styles/integrations.css). Named here because the anchors are
// minted here, and read by the Solid-rendered variant so both spellings cannot drift.
export const REF_LINK_CLASS = 'ref-inline-link'

/** The same split, applied to already-rendered HTML. github's PR bodies are `innerHTML` from GitHub's
 * sanitised markdown — opaque to the framework — and that consumer shape recurs anywhere a plugin
 * renders someone else's HTML, so it is a host helper rather than one plugin's DOM trick. */
export function linkifyRefs(root: HTMLElement, prefixes: ReadonlyMap<string, string>): void {
  if (!prefixes.size) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    // Never inside an existing link (it already goes somewhere) or code (an identifier there is a
    // literal). Collected first, because replacing as we walk would invalidate the walker.
    if (!text.parentElement?.closest('a, code, pre')) texts.push(text)
  }
  for (const text of texts) {
    const parts = splitRefTokens(text.data, prefixes)
    if (parts.length === 1 && !parts[0].ref) continue
    const fragment = document.createDocumentFragment()
    for (const part of parts) {
      if (!part.ref) {
        fragment.append(part.text)
        continue
      }
      const anchor = document.createElement('a')
      anchor.className = REF_LINK_CLASS
      // Deliberately NO href. There is no URL — that is the whole point of a bare token — so there is
      // also no browser fallback, which is why the click handler below consumes the event for one of
      // these whether or not the provider's panel is installed to receive it.
      anchor.dataset.refProvider = part.ref.providerId
      anchor.dataset.refItem = part.ref.item
      anchor.textContent = part.text
      fragment.append(anchor)
    }
    text.replaceWith(fragment)
  }
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
  const pane = paneContribution(target.pane)
  if (!pane) return false
  // Registered is not the same as AVAILABLE. A plugin pane's `when` is its per-node presence gate, so a
  // plugin installed but stopped on this task's node has a registered contribution and nothing to render
  // — and returning true there claimed the click, called `preventDefault`, and showed nothing. Refusing
  // is not a dead end: the caller's next rung, or the real URL, is still there.
  //
  // The task comes from the lookup rather than `activeTaskId()`, because a content link can name a task
  // that is not the active one and evaluating another task's predicate is worse than not evaluating it.
  // An unknown task leaves `when` unevaluated, which is the pre-existing behaviour: the list may simply
  // not have loaded, and refusing every pane in that window would be a new failure rather than a fix.
  if (!paneAvailable(pane, taskById(taskId))) return false
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
export type ContentLinkOutcome = 'route' | 'refPanel' | 'pane' | 'external'

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
  // It is a preference and not a choice, because any rung can be unavailable: no task means no pane, an
  // absent or disabled plugin means no panel, and no navigator or no declared `path` means no route.
  // Whichever is asked for is tried first and the rest follow in the default order, so a surface never has
  // to know which of the three the target's plugin actually installed.
  //
  // `route` joined the other two late, and its absence was a real bug rather than a missing feature. It
  // used to be tried FIRST, unconditionally, ahead of whatever the surface asked for — which is two wrong
  // answers in one line. A dashboard row for a Linear ticket got the glance panel when the reader was
  // asking to go there, and a GitHub link clicked inside a Linear issue would have torn the whole surface
  // away from a reader who was mid-sentence. Both are the same mistake: the target does not know where the
  // reader is, and it was deciding anyway.
  prefer?: 'route' | 'pane' | 'refPanel'
  // The shell's navigator, for the `route` rung. Absent is normal — a surface with no navigator in scope
  // simply has one fewer destination, and the others still work.
  navigate?: (to: string) => void
}

// The route rung. Navigating is only half of arriving: the shell draws from the rail selection rather than
// from the location, so a path whose source is not selected moves the address bar and leaves the previous
// surface on screen. A path no source claims is left alone — core's own routes are not rail sources.
function openRouteTarget(path: string | null | undefined, navigate: ((to: string) => void) | undefined): boolean {
  if (!path || !navigate) return false
  const source = sourceIdForPath(path)
  if (source) setSelectedSource(source)
  navigate(path)
  return true
}

// PANE BEFORE PANEL, and route last, for a surface that states no preference. This is the order those two
// have always resolved in, and the route joins the end rather than the front: a caller that did not ask to
// be moved should not be moved. Every surface that wants otherwise says so.
const DEFAULT_ORDER = ['pane', 'refPanel', 'route'] as const

// The general ladder: what the HOST can do with a recognised target, in the order the surface asked for.
// It deliberately knows nothing plugin-specific — a provider declares WHAT it has and the surface declares
// WHERE it wants to land, and neither ever names the other.
//
// `path` is passed in rather than resolved here because only `claimFor` knows which contribution made the
// claim, and a target must never be able to resolve to one provider's item and another's route.
function openClaim(target: InAppTarget, path: string | null | undefined, presentation: ContentLinkPresentation): ContentLinkOutcome {
  const order = presentation.prefer
    ? [presentation.prefer, ...DEFAULT_ORDER.filter((rung) => rung !== presentation.prefer)]
    : DEFAULT_ORDER
  for (const rung of order) {
    if (rung === 'pane' && openPluginContentTarget(target, presentation.taskId)) return 'pane'
    if (rung === 'refPanel' && openRefPanelTarget(target)) return 'refPanel'
    if (rung === 'route' && openRouteTarget(path, presentation.navigate)) return 'route'
  }
  return 'external'
}

/** The two rungs a caller holding only a target can reach. A route needs the contribution that claimed the
 *  href, which a bare target does not carry — `openInAppUrl` is the entry point that has both. */
export function openContentTarget(target: InAppTarget, presentation: ContentLinkPresentation = {}): ContentLinkOutcome {
  return openClaim(target, null, presentation)
}

// ── An external URL that a surface was about to hand to the browser ───────────────────────────────
//
// The whole question in one call: "does acorn have somewhere of its own for this URL?" A surface that
// holds a plain https URL — a dashboard row's `openUrl`, a `link` cell, a chrome badge — asks this
// first, and only opens the browser on a false.
//
// THIS is the general seam, and it exists because the first version of it was not. That one asked only
// about `path`, which is github's rung, so a Linear ticket on the same dashboard still left the app
// even though Linear already had a reference panel registered and a recogniser pointing at it. The
// three destinations were never github's or Linear's to enumerate — a provider declares what it has
// (a route, a panel, a pane) and this decides, so a plugin that ships any of them gets dashboard rows
// and link cells resolving with no code on either side.
export function openInAppUrl(href: string, destination: ContentLinkPresentation = {}): boolean {
  const claim = claimFor(href)
  if (!claim) return false
  return openClaim(claim.target, claim.contribution.path?.(claim.target), destination) !== 'external'
}

export function handlePluginContentLinkClick(event: MouseEvent, presentation: ContentLinkPresentation = {}): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  const anchor = (event.target as HTMLElement | null)?.closest('a') as HTMLAnchorElement | null
  if (!anchor) return false
  // A bare-token anchor `linkifyRefs` minted. It carries no href, so no recogniser can claim it and
  // there is no browser fallback to preserve — the click is the host's either way, which is why this
  // returns true even when `openRefPanel` refuses for want of an installed panel. The alternative is a
  // click that appears to do nothing AND leaves a real link the reader can see is not a link.
  const refProvider = anchor.dataset.refProvider
  const refItem = anchor.dataset.refItem
  if (refProvider && refItem) {
    openRefPanel({ providerId: refProvider, displayId: refItem })
    event.preventDefault()
    return true
  }
  const href = anchor.getAttribute('href')
  if (!href) return false
  // The full ladder, routes included, which is what let plugins/github delete its own copy of the route
  // rung: it used to call this first and then re-parse the href to do owner/name → project itself, purely
  // because this stopped at two destinations.
  //
  // An unrecognised URL, and a recognised one with nowhere in-app to go, are the same answer: the anchor
  // keeps its default and the real URL opens. Which is a FEATURE for the second case — see the deliberate
  // GitHub-repo-is-not-a-project fall-through in plugins/github/src/client/contentLinks.ts.
  if (!openInAppUrl(href, presentation)) return false
  event.preventDefault()
  return true
}
