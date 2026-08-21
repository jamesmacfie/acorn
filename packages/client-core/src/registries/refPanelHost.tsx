import { Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { handlePluginContentLinkClick } from './contentLinks'
import { activeRefPanel, closeRefPanel, refPanelFor } from './refPanels'
import { activeTaskId } from '../tasks/tasks'

// The one place a reference panel is drawn. Mounted once by the composition root, next to
// `WillConfirmationHost` and for the same reason: the state is shell state (docs/panes.md § Not a
// pane: the reference panel), so the thing that renders it belongs to the shell rather than to
// whichever surface happened to ask.
//
// It draws no chrome of its own, no backdrop, no header, no dismiss button, because a panel already
// brings all three: a manifest-declared panel is wrapped in the host's overlay classes and owns the
// close affordance, a first-party panel component draws its own (docs/plugins.md § "Loaded plugins:
// the client half"). Adding a second wrapper here would letterbox one and double-frame the other.
export function RefPanelHost() {
  return (
    <Show when={activeRefPanel()} keyed>
      {(target) => (
        // Resolved at render time, not when the ref was set. `openRefPanel` already refused a
        // provider with no panel, but a plugin can be disabled or a node switched between then and
        // now, and rendering nothing is the right degradation for a detail overlay
        // (registries/refPanels.ts).
        <Show when={refPanelFor(target.providerId)}>
          {(panel) => (
            // `target=`, never `ref=`: Solid compiles a component's `ref` attribute into a setter
            // method (docs/architecture-overview.md § Package boundaries, "Two renderer traps"), so
            // this exact line previously handed every panel a function in place of its subject.
            // registries/refPanels.ts § RefPanelProps has the full account.
            <Dynamic
              component={panel().component}
              target={target}
              onClose={closeRefPanel}
              // A link inside a panel's own content. `prefer: 'refPanel'` so a ticket linking a
              // sibling ticket swaps this panel rather than pushing a pane behind it, the reader asked
              // to look sideways, twice.
              onContentClick={(event: MouseEvent) => handlePluginContentLinkClick(event, { taskId: activeTaskId(), prefer: 'refPanel' })}
            />
          )}
        </Show>
      )}
    </Show>
  )
}
