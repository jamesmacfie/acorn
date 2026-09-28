/** @jsxImportSource @acorn/tui/jsx */
import { For, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import { COLLECTION_INTENTS, createCollectionIntents, type Intent } from '@acorn/client-core/kit/keys'
import { Line, slot } from '../cells'
import { bindKeys } from '../../keys/install'
import { enterParent, markParent, moveRegion, walkStops } from '../../keys/regions'
import { stop } from '../../keys/stops'
import { PARENT } from '../../keys/tiers'
import { ScrollViewport } from '../scrolling'
import { panelsFor, registerPanel } from './panelRegistry'

const labelOf = (tab: { label: string; icon?: string }): string => tab.label

/** Draw a tab strip and keep each label intact when the row wraps or clips. */
export function Tabs(props: {
  tabs: readonly { id: string; label: string; count?: number; icon?: string; title?: string }[]
  active: string
  onChange: (id: string) => void
  idPrefix: string
  ariaLabel: string
  actions?: JSX.Element
}) {
  const step = (delta: 1 | -1): boolean => {
    const at = props.tabs.findIndex((tab) => tab.id === props.active)
    const next = props.tabs[at + delta]
    // At the edge, let the region tier move to the next column.
    if (!next) return false
    props.onChange(next.id)
    return true
  }
  return (
    // Wrap labels to retain access at narrow widths. A column gap adds no blank row.
    <box
      flexDirection="row"
      flexWrap="wrap"
      columnGap={2}
      rowGap={0}
      flexShrink={0}
      overflow="hidden"
      ref={(element: Renderable) => {
        // Declare focusability where the renderable is built.
        element.focusable = true
        // Panel strips are parent stops. Empty strips remain ordinary controls.
        // Controls inside a panel can use step to change its selected tab.
        markParent(element, () => panelsFor(props.idPrefix), step)
        bindKeys(element, [
          ...['left', 'h'].map((key) => ({ key, cmd: () => step(-1) })),
          ...['right', 'l'].map((key) => ({ key, cmd: () => step(1) })),
          // Into the panel this strip is showing. A strip with no panels — a filter — falls through
          // to the next stop beside it, and a top-level pane strip is its own region, so its Down
          // edge continues into the following pane region instead.
          ...['down', 'j'].map((key) => ({
            key,
            cmd: () => enterParent(element) || walkStops(element, 1) || moveRegion(1),
          })),
          // And back out the way it came. Up is the previous stop beside the strip and nothing else:
          // a strip is one stop from outside, so its own tabs are not what Up walks. `walkStops`
          // answers false where the strip is the first stop in the box around it, which is the
          // bubble the contract asks for (docs/tui.md § The five key groups). Without this a strip
          // was the one stop on the screen with no Up at all: a reader who reached a `Sections` strip
          // by walking down to it had no arrow that took them back off it.
          ...['up', 'k'].map((key) => ({ key, cmd: () => walkStops(element, -1) })),
        ], PARENT, { mode: 'focus' })
      }}
    >
      <For each={props.tabs}>
        {(tab) => (
          // `height={1}`, because a wrapped flex line is as tall as its tallest child and a child
          // with no height of its own takes the container's — which drew the second row of tabs three
          // rows below the first.
          <box flexShrink={0} height={1}>
            <Line role={props.active === tab.id ? 'strong' : 'body'} tone={props.active === tab.id ? 'accent' : undefined}>
              {props.active === tab.id ? `[${labelOf(tab)}]` : labelOf(tab)}
              {tab.count === undefined ? '' : ` ${tab.count}`}
            </Line>
          </box>
        )}
      </For>
      <box flexGrow={1} />
      {slot(props.actions)}
    </box>
  )
}

/** The panel half. `hidden` rather than unmounting, the same thunk rule the DOM layout keeps, so a
 *  panel holds its state across a switch. */
export function TabPanel(props: {
  idPrefix: string
  id: string
  active: string
  children: JSX.Element
}) {
  return (
    <ScrollViewport
      visible={props.active === props.id}
      onBox={(box) => registerPanel(props.idPrefix, box)}
    >
      {props.children}
    </ScrollViewport>
  )
}
/** One line of tab labels with a `×` on the current one. */
export function DocumentTabs(props: {
  tabs: readonly { id: string; label: string; dirty?: boolean; status?: 'ok' | 'warn' | 'muted'; ephemeral?: boolean; pending?: boolean; title?: string }[]
  active: string
  onActivate: (id: string) => void
  onClose?: (id: string) => void
  onPromote?: (id: string) => void
  actions?: JSX.Element
  idPrefix: string
  ariaLabel: string
}) {
  // A horizontal collection, the same shape `SegmentedControl` is and for the same reason: there is
  // nothing per tab to focus in one run of text, so the strip holds the keys and `←`/`→` move the
  // value. The list rules — what wraps, where the first press lands — are the shared ones
  // (client-core kit/keys/collectionIntents.ts).
  //
  // Not a parent stop, unlike a `Tabs` with panels. The document an editor tab opens is the layout's
  // own region below the strip, not a panel this strip owns, so `↓` leaves the strip by the ordinary
  // walk rather than entering something.
  const keys = createCollectionIntents({
    id: () => props.idPrefix,
    items: () => props.tabs.map((tab) => ({ key: tab.id, label: tab.label })),
    orientation: 'horizontal',
    // Moving opens, which is what a document strip means: a reader walking the tabs is reading them.
    selectOnMove: true,
    selected: () => props.active,
    onSelect: (id) => props.onActivate(id),
    land: () => {},
    onItem: () => false,
  })
  const control = stop({
    on: {
      ...Object.fromEntries(COLLECTION_INTENTS.map((intent) => [intent, () => keys.handle(intent)])),
      // The collection declines `activate` because `onItem` is false — there is no per-tab renderable
      // to stand on — so Enter is answered here: it re-opens whatever the caret is already on, which
      // is how a reader gets back to the document after walking away from it.
      activate: () => { props.onActivate(props.active); return true },
      delete: () => {
        if (!props.onClose) return false
        props.onClose(props.active)
        return true
      },
    } as Partial<Record<Intent, () => boolean>>,
  })
  return (
    <box flexDirection="row" gap={2} ref={control.ref}>
      {/* The caret every collection draws, for the reason the pane strip gives: the current tab is
          already marked, and a mark that means two things means neither (../chrome/PaneRow.tsx). */}
      <Line tone="accent">{control.focused() ? '\u203a' : ' '}</Line>
      <For each={props.tabs}>
        {(tab) => (
          <Line
            role={props.active === tab.id ? 'strong' : 'body'}
            tone={tab.dirty ? 'accent' : tab.status === 'warn' ? 'warn' : undefined}
          >
            {tab.label}{tab.dirty ? ' ●' : ''}{props.active === tab.id && props.onClose ? ' ×' : ''}
          </Line>
        )}
      </For>
      <box flexGrow={1} />
      {slot(props.actions)}
    </box>
  )
}
