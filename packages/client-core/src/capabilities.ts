import { isDesktopHost } from './platform'
import { disabledNodePlugins } from './node/nodePlugins'

// What a contribution may require before it's shown. Two axes, and they're not the same question:
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
export type Capabilities = {
  desktop: boolean // a desktop shell is hosting this renderer (native dialogs, WebContentsView panes)
  terminal: boolean // this node runs terminals (drawer, agents, run targets, workflows, PTY streams)
}

export type ClientCapabilityRequirement = 'none' | keyof Capabilities

// Reactive: `disabledNodePlugins` is a signal, so a surface gated on `terminal` follows the roster and
// the owner's toggle without anyone re-reading it. Empty until the first roster read resolves, which is
// the right default: a node that hasn't answered must not be assumed to have anything disabled, or the
// first paint drops panes and then adds them back.
export const capabilities = (): Capabilities => ({
  desktop: isDesktopHost(),
  terminal: !disabledNodePlugins().includes('terminal'),
})

export const hasClientCapability = (requirement: ClientCapabilityRequirement = 'none'): boolean =>
  requirement === 'none' || capabilities()[requirement]
