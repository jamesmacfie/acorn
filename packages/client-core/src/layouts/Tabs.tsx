import { Show } from 'solid-js'
import { Tabs as TabStrip } from '../ui/Tabs'
import { layoutState } from './state'
import type { LayoutProps } from './regions'

// `tabs`: a bar the host draws, and one panel region per tab, drawn one at a time.
//
// Distinct from the `Tabs` kit node this borrows the strip from, which switches panels inside a tree.
// This is for a pane whose top level is tabs, so the host can persist the selection under the pane id
// and give the strip the `⌘1`..`⌘9` chord inside the pane, which phase 2 attaches.
//
// The bar is one focus stop with roving focus; the visible panel is a focus group.
//
// Narrow: the bar scrolls horizontally. Terminal: the bar is one line.
export function Tabs(props: LayoutProps) {
  const tabs = () => props.tabs ?? []
  const [selected, setSelected] = layoutState(props.stateKey, 'tab', '')
  // Falls back rather than storing a default, so a pane whose tab set changes under a stored id lands
  // on its first tab instead of on nothing.
  const active = () => (tabs().some((tab) => tab.id === selected()) ? selected() : tabs()[0]?.id ?? '')

  return (
    <div class="pane layout-tabs">
      <TabStrip tabs={tabs()} active={active()} onChange={setSelected} idPrefix={props.stateKey} ariaLabel={props.label} />
      {/* One panel mounted at a time, which is what the region thunks are for: an unselected tab's
          region is never called, so a pane with eight tabs opens one. `Tabs.Panel` hides rather than
          unmounts, and that is the right trade inside a tree and the wrong one for a whole pane. */}
      <Show when={active()}>
        {(id) => (
          <div
            class="layout-tabs-panel"
            role="tabpanel"
            id={`${props.stateKey}-panel-${id()}`}
            aria-labelledby={`${props.stateKey}-tab-${id()}`}
          >
            {props.regions[`panel:${id()}`]?.()}
          </div>
        )}
      </Show>
    </div>
  )
}
