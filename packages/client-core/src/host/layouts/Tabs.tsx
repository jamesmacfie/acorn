import { onCleanup, onMount, Show } from 'solid-js'
import { keymap } from '../keys/install'
// Imported for `use:regionFocus` below: Solid compiles a directive to a bare reference, so the
// import has to be here even though nothing calls it.
// eslint-disable-next-line no-unused-vars -- used by the `use:regionFocus` directive.
import { regionFocus } from '../keys/regions'
import { Tabs as TabStrip } from '../../kit/components/Tabs'
import { layoutState } from './state'
import type { LayoutProps } from './regions'

// `tabs`: a bar the host draws, and one panel region per tab, drawn one at a time.
//
// Distinct from the `Tabs` kit node this borrows the strip from, which switches panels inside a tree.
// This is for a pane whose top level is tabs, so the host can persist the selection under the pane id
// and give the strip the `⌘1`..`⌘9` chord inside the pane.
//
// The bar is one focus stop with roving focus; the visible panel is the focus group.
//
// Narrow: the bar scrolls horizontally. Terminal: the bar is one line.

/** The most tabs a chord can reach. Nine, because `⌘0` is a zoom reset on every platform. */
const CHORD_TABS = 9

export function Tabs(props: LayoutProps) {
  const tabs = () => props.tabs ?? []
  const [selected, setSelected] = layoutState(props.stateKey, 'tab', '')
  // Falls back rather than storing a default, so a pane whose tab set changes under a stored id lands
  // on its first tab instead of on nothing.
  const active = () => (tabs().some((tab) => tab.id === selected()) ? selected() : tabs()[0]?.id ?? '')

  // `⌘1`..`⌘9` inside this pane, as a focus-within layer above the global one that switches tasks.
  // Priority is what decides that, not how local the layer is: the engine sorts on priority and then
  // on registration order (keys/install.ts § three tiers).
  // Deferred to `onMount` for the reason `bindIntents` is: a ref fires while the element is still
  // detached, and the keymap refuses a target that is not in the document.
  const bindChords = (element: HTMLElement) => onMount(() => {
    const engine = keymap()
    if (!engine) return
    onCleanup(engine.registerLayer({
      target: element,
      targetMode: 'focus-within',
      priority: 30,
      bindings: Array.from({ length: CHORD_TABS }, (_, index) => ({
        key: `super+${index + 1}`,
        cmd: () => {
          const tab = tabs()[index]
          if (!tab) return false
          setSelected(tab.id)
          return true
        },
      })),
    }))
  })

  return (
    <div class="pane layout-tabs" ref={bindChords}>
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
            use:regionFocus={{ paneId: props.stateKey, regionId: 'panel' }}
          >
            {props.regions[`panel:${id()}`]?.()}
          </div>
        )}
      </Show>
    </div>
  )
}
