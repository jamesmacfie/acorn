import { createUniqueId, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import PluginFrame from './PluginFrame'
import { RemoteTree } from '../tree/RemoteTree'
import type { RemoteContribution } from '../tree/treeRegistry'
import type { FrameBinding } from './broker'
import { Toolbar } from '../../kit/components/primitives'
import { IconButton } from '../../kit/components/inputs/IconButton'
import RefPanelTaskLink from '../components/RefPanelTaskLink'
import { createDismissable } from '../../kit/lib/controls/dismissable'
import { restoreFocusOnCleanup } from '../../kit/keys/trap'

// The host's chrome around a plugin reference panel: the backdrop, the box, the title and the
// dismiss affordance (docs/plugins/frames.md § Frame contribution kind).
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
  /** Set when the panel declared a layout with a remote region: the body is a tree of the host's own
   *  components rather than the plugin's rectangle. The box around it does not change, which is the
   *  whole reason a panel could move paths without anything else moving with it. */
  tree?: RemoteContribution
}

export default function PluginRefPanel(props: PluginRefPanelProps) {
  // A dialog's keys and focus, as RefPanelBox has. Escape reaches this only while focus is in the
  // host's part of the panel: a key pressed inside the frame stays in the frame.
  let panel!: HTMLElement
  const titleId = createUniqueId()
  const dismiss = createDismissable({ onDismiss: () => props.onClose(), container: () => panel })
  restoreFocusOnCleanup()
  onMount(() => queueMicrotask(() => panel?.focus({ preventScroll: true })))
  return (
    <Portal>
      <div class="integrations-panel-backdrop" onClick={dismiss.onBackdropClick} />
      <aside
        ref={panel}
        class="integrations-panel plugin-ref-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabindex="-1"
        onClick={dismiss.onContainerClick}
        onKeyDown={dismiss.onKeyDown}
      >
        <header class="integrations-panel-head">
          {/* No fallback, deliberately. `openRefPanel` refuses a falsy `displayId`, so a panel with
              no subject is unreachable and a `?? 'Reference'` here would only be able to hide a bug
              — which is precisely what it would have done: the empty title was the visible half of
              the reserved-`ref`-prop defect, and the reason it was found at all. */}
          <span class="integrations-panel-title" id={titleId}>{props.displayId}</span>
          <Toolbar.Spacer />
          <IconButton icon="x" label="Close" onPress={props.onClose} />
        </header>
        <Show
          when={props.tree}
          fallback={<PluginFrame binding={props.binding} hash={props.hash} refId={props.displayId} onClose={props.onClose} />}
        >
          {(contribution) => (
            <RemoteTree
              contribution={contribution()}
              props={() => ({ item: props.displayId })}
              scope={() => ({ item: props.displayId })}
            />
          )}
        </Show>
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
