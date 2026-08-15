import type { JSX } from 'solid-js'
import ExtensionPointHost from '../chrome/ExtensionPointHost'
import '../chrome/extension-points.css'

// A pane whose owner reserved a strip for other plugins' rows: the owner's frame above, the HOST's own
// markup below (@acorn/protocol/extensionPoints.ts).
//
// This component is the boundary made visible. Above the divider is a sandboxed document served from the
// owner's bundle hash; below it is the shell drawing descriptors from a different package's node route.
// Neither can see the other — the strip is not inside the iframe, and the iframe is not told the strip
// exists. That is the difference between cooperative extension and a content script.
//
// The owner ships nothing to get this. `layout` templates exist for panes the host draws PART of; this is
// not one of those, because the owner's rectangle is unchanged apart from losing some height. So it needs
// no template entry and no region: one `extensionPoints` line in the manifest is the whole opt-in.
export default function ExtendedPane(props: { pointId: string; children: JSX.Element }) {
  return (
    <div class="extended-pane">
      <div class="extended-pane-frame">{props.children}</div>
      <ExtensionPointHost pointId={props.pointId} />
    </div>
  )
}
