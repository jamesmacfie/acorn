import { type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { Button, Toolbar } from '../../kit/components/primitives'

// The box a reference panel is drawn in: the backdrop, the drawer, the title and the dismiss
// affordance (docs/panes.md § Not a pane: the reference panel).
//
// The host's, so a panel is a tree and nothing else. A first-party panel drew all four itself before
// the layout programme, which meant every provider's panel was a chance to get the overlay's z-index,
// its dismissal or its landmark slightly wrong. The classes are the ones a loaded plugin's panel is
// already wrapped in (plugins/frames/PluginRefPanel.tsx), so the two are the same box.
//
// That file keeps its own copy for now: a frame is an iframe and takes the drawer's height directly
// rather than sitting inside the scrolling body below, which is a different arrangement rather than
// the same one with a flag.

export default function RefPanelBox(props: {
  /** What the panel is about, as the host resolved it. Shown in the header. */
  title: string
  onClose: () => void
  children: JSX.Element
  /** Pinned under the scrolling body: the host's task-link control, and nothing else so far. */
  footer?: JSX.Element
}) {
  return (
    <Portal>
      <div class="integrations-panel-backdrop" onClick={props.onClose} />
      <aside class="integrations-panel">
        <header class="integrations-panel-head">
          <span class="integrations-panel-title">{props.title}</span>
          <Toolbar.Spacer />
          <Button onPress={props.onClose} label="Close">✕</Button>
        </header>
        <div class="integrations-panel-body">{props.children}</div>
        {props.footer}
      </aside>
    </Portal>
  )
}
