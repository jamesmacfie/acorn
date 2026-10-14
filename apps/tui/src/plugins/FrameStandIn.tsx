/** @jsxImportSource @acorn/tui/jsx */
import { Show } from 'solid-js'
import type { PluginFrameProps } from '@acorn/client-core/host/frames/frameServices.ts'
import { pluginLabel } from '@acorn/client-core/host/plugins'
import { Line } from '../kit/cells'

// What this host draws where a loaded plugin asked for a frame: one line that names the plugin, so a
// reader knows the space was reserved and where to see it. The reconciler refuses the DOM's `<iframe>`,
// which threw "Unknown component type" and took the whole panel down (docs/tui/plugin-losses.md).
//
// A controller-only frame is never seen on the desktop either, so it draws nothing here.
export function FrameStandIn(props: PluginFrameProps) {
  return (
    <Show when={!props.controllerOnly}>
      <Line role="muted" wrap>
        {`${pluginLabel(props.binding.pluginId)} draws this view as a web page, which the terminal can't show. Open it in the desktop app.`}
      </Line>
    </Show>
  )
}
