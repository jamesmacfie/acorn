import { isDesktopHost } from './platform'
import { disabledNodePlugins } from './node/nodePlugins'

// What the surroundings offer a contribution: is a desktop shell hosting this renderer, and does the
// node behind it run terminals. "Host" rather than "client" because the word `capability` on its own is
// taken: `clientCapabilities.ts` holds the plugin-to-plugin one, and a source's `requiresProvider` asks
// whether a connected integration grants an operation. Three questions, three names.
//
// Two axes, and they're not the same question:
//
// - `desktop`   is a desktop shell hosting this renderer. True platform gating, for surfaces that need
//               something only a shell can do (a native folder dialog, a WebContentsView).
// - `terminal`  does the node run terminals. A node question, answered by the node's plugin roster,
//               because the terminal drawer, agents, run targets and workflows are ordinary `/v2` plus
//               WebSocket surfaces that work from any client.
//
// Those two were one probe until 2026-08-15, and it was the wrong one: `terminal` meant "the preload
// exposes a native folder picker", so the whole terminal, agents and workflows block was hidden from
// anything that wasn't Electron, and stayed visible on a desktop whose node had terminal turned off.
//
// Reach for `desktop` sparingly. It's right for the folder picker and the preview pane; it's wrong for
// anything whose implementation is an HTTP route.
export type HostCapabilities = {
  desktop: boolean // a desktop shell is hosting this renderer (native dialogs, WebContentsView panes)
  terminal: boolean // this node runs terminals (drawer, agents, run targets, workflows, PTY streams)
}

// `requires` on a contribution, and the rule for where that field belongs: EVERY contribution the host
// filters before drawing takes it, because the question is the host's and the answer is the same
// everywhere. `when` is the other gate and is deliberately not uniform — it is the contribution's own
// predicate over whatever context that draw site has, so it exists where the host has a context to hand
// it and is absent where there is none (a client schedule, a settings page). Reading three different
// gate combinations off six registries and trying to derive the rule was the 2026-08-27 finding.
export type HostCapabilityRequirement = 'none' | keyof HostCapabilities

// Reactive: `disabledNodePlugins` is a signal, so a surface gated on `terminal` follows the roster and
// the owner's toggle without anyone re-reading it. Empty until the first roster read resolves, which is
// the right default: a node that hasn't answered must not be assumed to have anything disabled, or the
// first paint drops panes and then adds them back.
export const hostCapabilities = (): HostCapabilities => ({
  desktop: isDesktopHost(),
  terminal: !disabledNodePlugins().includes('terminal'),
})

export const hasHostCapability = (requirement: HostCapabilityRequirement = 'none'): boolean =>
  requirement === 'none' || hostCapabilities()[requirement]
