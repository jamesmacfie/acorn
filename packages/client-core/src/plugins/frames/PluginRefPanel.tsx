import { Portal } from 'solid-js/web'
import PluginFrame from './PluginFrame'
import type { FrameBinding } from './broker'
import { Button, Toolbar } from '../../ui/primitives'
import RefPanelTaskLink from '../../registries/RefPanelTaskLink'

// The host's chrome around a plugin reference panel: the backdrop, the box, the title and the
// dismiss affordance (docs/plugins.md § Frame contribution kind).
//
// The overlay is the host's here, unlike a first-party panel that draws its own. Two reasons, both
// structural rather than stylistic. A frame is an iframe: it cannot Portal out of the box the consumer
// put it in, so `position: fixed` inside the frame positions against the frame, and a ref panel
// rendered inline into a PR conversation would be a 150px letterbox in the middle of a page. And a
// refPanel frame has no way to call `onClose`: the bridge's close verb is gated to importer surfaces
// (frames/broker.ts), deliberately, so the dismiss affordance has to live on this side of the port
// too. Same classes the first-party panels use, so the two look identical.
//
// A file of its own rather than markup inside ./register.ts, for the reason that module states at the
// top: register.ts holds the decisions and must stay importable from a bare-Node suite, so the JSX
// lives behind a `lazy` boundary.

export type PluginRefPanelProps = {
  binding: FrameBinding
  hash: string
  // The reference the panel was opened for, as the host resolved it.
  displayId: string
  onClose: () => void
}

export default function PluginRefPanel(props: PluginRefPanelProps) {
  return (
    <Portal>
      <div class="integrations-panel-backdrop" onClick={props.onClose} />
      <aside class="integrations-panel plugin-ref-panel">
        <header class="integrations-panel-head">
          {/* No fallback, deliberately. `openRefPanel` refuses a falsy `displayId`, so a panel with
              no subject is unreachable and a `?? 'Reference'` here would only be able to hide a bug
              — which is precisely what it would have done: the empty title was the visible half of
              the reserved-`ref`-prop defect, and the reason it was found at all. */}
          <span class="integrations-panel-title">{props.displayId}</span>
          <Toolbar.Spacer />
          <Button class="integrations-panel-close" onClick={props.onClose} aria-label="Close">✕</Button>
        </header>
        <PluginFrame binding={props.binding} hash={props.hash} refId={props.displayId} onClose={props.onClose} />
        {/* Host-drawn, below the frame rather than inside it. Creating a task is a core write that makes a
            worktree, and a plugin that drew this itself would need `core.tasks:write` for its whole life
            to earn one button — ../../registries/RefPanelTaskLink.tsx has the argument in full. */}
        {/* `pluginId` IS the provider here, not an approximation: a refPanel frame declares `providerId`
            in its manifest and registries/plugin.ts throws when a plugin names one that is not its own. */}
        <RefPanelTaskLink target={{ providerId: props.binding.pluginId, displayId: props.displayId }} />
      </aside>
    </Portal>
  )
}
