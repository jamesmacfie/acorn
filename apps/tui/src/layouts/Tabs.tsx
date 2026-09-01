/** @jsxImportSource @opentui/solid */
import { Show } from 'solid-js'
import type { BoxRenderable } from '@opentui/core'
import type { LayoutProps } from '@acorn/client-core/host/layouts/regions.ts'
import { layoutState } from '@acorn/client-core/host/layouts/state.ts'
import { Tabs as TabStrip } from '../kit/grouping'
import { bindKeys } from '../keys/install'
import { Panel } from '../panel'
import { regionFocus } from '../keys/regions'

// `tabs`: the bar is one line, the current panel below (docs/panes.md § Layout model).
//
// Distinct from the `Tabs` kit node this borrows the strip from, which switches panels inside a tree.
// This is for a pane whose top level is tabs, so the host persists the selection under the pane id —
// the same session signal the DOM layout uses, shared as it is — and gives the strip the pane chords.
//
// Hidden panels never mount, which is the thunk rule the DOM layout keeps: an unselected tab's region
// is never called, so a pane with eight tabs opens one.

/** The most tabs a chord can reach. Nine, as on the desktop, for the same reason: the tenth would be
 *  a zero and every platform has already spent it. */
const CHORD_TABS = 9

export function Tabs(props: LayoutProps) {
  const tabs = () => props.tabs ?? []
  const [selected, setSelected] = layoutState(props.stateKey, 'tab', '')
  // Falls back rather than storing a default, so a pane whose tab set changes under a stored id lands
  // on its first tab instead of on nothing.
  const active = () => (tabs().some((tab) => tab.id === selected()) ? selected() : tabs()[0]?.id ?? '')

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      ref={(element: BoxRenderable) => {
        // Layer 30, the pane's own tier, focus-within on the pane box. Priority is what decides,
        // not how local the layer is (client-core host/keys/install.ts § the four tiers).
        bindKeys(element, Array.from({ length: CHORD_TABS }, (_, index) => ({
          key: `super+${index + 1}`,
          cmd: () => {
            const tab = tabs()[index]
            if (!tab) return false
            setSelected(tab.id)
            return true
          },
        })), 30)
      }}
    >
      <TabStrip tabs={tabs()} active={active()} onChange={setSelected} idPrefix={props.stateKey} ariaLabel={props.label} entry />
      <Show when={active()}>
        {(id) => (
          <Panel
            grow
            scroll
            title={tabs().find((tab) => tab.id === id())?.label}
            onBox={regionFocus({ paneId: props.stateKey, regionId: 'panel' }, 1)}
          >
            {props.regions[`panel:${id()}`]?.()}
          </Panel>
        )}
      </Show>
    </box>
  )
}
