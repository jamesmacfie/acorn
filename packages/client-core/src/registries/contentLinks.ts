import { Registry } from './registry'

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
  parse: (href: string) => InAppTarget | null
}

export const contentLinkRegistry = new Registry<ContentLinkContribution>('content-link')

// First recogniser to claim the href wins. Order is the registry's declared order, so two providers
// whose patterns overlap resolve deterministically rather than by registration accident.
export function parseInAppTarget(href: string): InAppTarget | null {
  for (const contribution of contentLinkRegistry.entries()) {
    const target = contribution.parse(href)
    if (target) return target
  }
  return null
}
