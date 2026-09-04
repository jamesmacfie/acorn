import { Show } from 'solid-js'
import PluginFrame from './PluginFrame'
import type { FrameBinding } from './broker'
import { closePluginOverlay, closePluginOverlayWith, pluginOverlayInvocation } from './overlays'
import { Button } from '../../kit/components/primitives'

// The host's chrome around a plugin overlay: the full-screen picker slot, what the editor's ⌘P file
// palette occupies as a compiled contribution (docs/plugins.md § Frame contribution kind).
//
// Same division of labour as PluginRefPanel: the host draws the backdrop, the box and the dismiss
// affordance, because an iframe cannot position itself against anything outside its own rectangle. And
// the same reason for being its own file: ./register.ts must stay importable from a bare-Node suite.
//
// Nothing here decides when it appears. An overlay has no click site of its own: what opens one is the
// `openOverlay` verb (plugins/chrome/actions.ts) or a remote tree asking for its companion overlay
// (../tree/RemoteTree.tsx). Both arrive here as an invocation on ./overlays.ts.

export type PluginOverlayProps = {
  label: string
  hash: string
  open: () => boolean
  // An accessor, not a value, because it is read when the overlay opens rather than when the slot
  // mounts: the binding carries the active task, and a picker's job is usually to put something into
  // one, so it has to be the task that was on screen when the reader asked for the picker.
  binding: () => FrameBinding
}

export default function PluginOverlay(props: PluginOverlayProps) {
  const invocation = () => (props.open() ? pluginOverlayInvocation() : null)
  return (
    <Show when={invocation()} keyed>
      {/* Keyed on the invocation, so opening the same overlay a second time builds a second iframe with
          only the second input. A reused document would let an editor inherit the previous canvas, and
          the reader would have no way to tell which image they were drawing on. */}
      {(open) => (
        <div class="overlay-backdrop" onClick={closePluginOverlay}>
          <div class="overlay plugin-overlay" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header class="overlay-title plugin-overlay-head">
              <span>{props.label}</span>
              <Button variant="bare" onPress={closePluginOverlay} label="Close">✕</Button>
            </header>
            <div class="plugin-overlay-body">
              <PluginFrame
                binding={props.binding()}
                hash={props.hash}
                {...(open.input === undefined ? {} : { input: open.input })}
                onClose={(result) => (result === undefined ? closePluginOverlay() : closePluginOverlayWith(result))}
              />
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
