import { Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { handlePluginContentLinkClick } from './contentLinks'
import { activeRefPanel, closeRefPanel, refPanelFor } from './refPanels'
import { activeTaskId } from '../tasks/tasks'

// The one place a reference panel is drawn. Mounted once by the composition root, next to
// `WillConfirmationHost` and for the same reason: the state is shell state, so the thing that renders it
// belongs to the shell rather than to whichever surface happened to ask.
//
// It draws NO chrome of its own — no backdrop, no header, no dismiss button — because a panel already
// brings all three. A manifest-declared panel is an iframe that cannot `Portal` out of the box it is put
// in, so plugins/frames/register.tsx wraps it in the host's overlay classes on this side of the port and
// owns the close affordance (the bridge's close verb is gated to importer surfaces); a first-party panel
// component draws its own. Adding a second wrapper here would letterbox one and double-frame the other.
//
// Which also answers the question this file otherwise raises — "where does a panel go when the surface has
// no second column to put it in?". It goes where it already went: over the page. plugins/github's PR detail
// rendered `refPanelFor('linear')` inline in its conversation column, but every panel in the app today is a
// frame, and a frame portals out to a fixed overlay regardless of where its consumer placed it. So moving
// the mount point here changes nothing about where the panel appears, and everything about who can open one.
export function RefPanelHost() {
  return (
    <Show when={activeRefPanel()} keyed>
      {(target) => (
        // Resolved at RENDER time, not when the ref was set. `openRefPanel` already refused a provider with
        // no panel, but a plugin can be disabled or a node switched between then and now, and rendering
        // nothing is the right degradation for a detail overlay (registries/refPanels.ts).
        <Show when={refPanelFor(target.providerId)}>
          {(panel) => (
            // `target=`, never `ref=`. Solid compiles a component's `ref` attribute into a setter method,
            // so this exact line previously handed every panel a function in place of its subject —
            // registries/refPanels.ts § RefPanelProps has the full account.
            <Dynamic
              component={panel().component}
              target={target}
              onClose={closeRefPanel}
              // A link inside a panel's own content. `prefer: 'refPanel'` so a ticket linking a sibling
              // ticket SWAPS this panel rather than pushing a pane behind it — the reader asked to look
              // sideways, twice.
              onContentClick={(event: MouseEvent) => handlePluginContentLinkClick(event, { taskId: activeTaskId(), prefer: 'refPanel' })}
            />
          )}
        </Show>
      )}
    </Show>
  )
}
