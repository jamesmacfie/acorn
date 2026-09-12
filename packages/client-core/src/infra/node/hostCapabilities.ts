import { isDesktopHost } from '../platform'
import { seamPresent, type SeamGroup } from '../platform/contract'
import { disabledNodePlugins } from './nodePlugins'

// What the surroundings offer a contribution: is a desktop shell hosting this renderer, and does the
// node behind it run the plugin this surface is built on. "Host" rather than "client" because the word
// `capability` on its own is taken: `clientCapabilities.ts` holds the plugin-to-plugin one, and a
// source's `requiresProvider` asks whether a connected integration grants an operation. Three
// questions, three names.
//
// Three kinds of question, and they are not the same one:
//
// - `'desktop'`        is a desktop shell hosting this renderer. True platform gating, for surfaces
//                      that need something only a shell can do (a native folder dialog). A closed
//                      question with one answer, so it stays a bare word.
// - `{ plugin: id }`   does the node run that plugin. Answered by the node's plugin roster, because
//                      the terminal drawer, agents, run targets and workflows are ordinary `/v2` plus
//                      WebSocket surfaces that work from any client.
// - `{ seam: group }`  did this host install that group of the platform seam. Answered by the seam's
//                      own probe (../platform/contract.ts), so the question the rail asks and the
//                      object the surface calls are the same one.
//
// Those two were one probe until 2026-08-15, and it was the wrong one: `terminal` meant "the preload
// exposes a native folder picker", so the whole terminal, agents and workflows block was hidden from
// anything that wasn't Electron, and stayed visible on a desktop whose node had terminal turned off.
//
// The plugin half was then a second closed word, `terminal`, which hardcoded one plugin's name into
// core: a contribution could not say "needs docker" or "needs workflows", and could not require two
// things (2026-08-27 extensibility review, finding 8). `disabledNodePlugins()` already answers the
// question for any id, so the requirement now carries the id and core names no plugin.
//
// Reach for `'desktop'` sparingly. It is right for a surface that is about the shell itself, and
// wrong both for anything whose implementation is an HTTP route and for anything a shell can ship
// without — the desktop's own preview views are optional, so the preview pane asks `{ seam: 'preview' }`
// rather than "am I the desktop" (docs/frontend.md § The desktop gate audit).
export type HostRequirement =
  | 'desktop'
  | { plugin: string }
  | { seam: SeamGroup }

// `requires` on a contribution, and the rule for where that field belongs: EVERY contribution the host
// filters before drawing takes it, because the question is the host's and the answer is the same
// everywhere. `when` is the other gate and is deliberately not uniform — it is the contribution's own
// predicate over whatever context that draw site has, so it exists where the host has a context to hand
// it and is absent where there is none (a client schedule, a settings page). Reading three different
// gate combinations off six registries and trying to derive the rule was the 2026-08-27 finding.
//
// An array means all of them. `'none'` is kept as a spelling of "no requirement" so a contribution can
// say so out loud where omitting the field would read as an oversight.
export type HostCapabilityRequirement = 'none' | HostRequirement | readonly HostRequirement[]

// Reactive: `disabledNodePlugins` is a signal, so a surface gated on a plugin follows the roster and
// the owner's toggle without anyone re-reading it. Empty until the first roster read resolves, which is
// the right default: a node that hasn't answered must not be assumed to have anything disabled, or the
// first paint drops panes and then adds them back.
const meets = (requirement: HostRequirement): boolean => {
  if (requirement === 'desktop') return isDesktopHost()
  if ('seam' in requirement) return seamPresent(requirement.seam)
  return !disabledNodePlugins().includes(requirement.plugin)
}

export const hasHostCapability = (requirement: HostCapabilityRequirement = 'none'): boolean => {
  if (requirement === 'none') return true
  return Array.isArray(requirement) ? requirement.every(meets) : meets(requirement as HostRequirement)
}
