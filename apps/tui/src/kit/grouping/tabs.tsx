/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, For, onCleanup, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import { COLLECTION_INTENTS, createCollectionIntents, type Intent } from '@acorn/client-core/kit/keys'
import { Line, slot } from '../cells'
import { bindKeys } from '../../keys/install'
import { enterParent, markEntry, markParent, moveRegion, scheduleSettle, walkStops } from '../../keys/regions'
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
  /** DOM pane-header geometry; terminal tabs remain one text row. */
  level?: 'pane'
  actions?: JSX.Element
  /** A remote tree's spelling of `actions`: its controls arrive as child nodes. */
  children?: JSX.Element
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
        bindKeys(
          element,
          [
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
            // bubble the contract asks for (docs/tui/keys.md § The five key groups). Without this a strip
            // is the one stop on the screen with no Up at all: a reader who reaches a `Sections` strip
            // by walking down to it has no arrow that takes them back off it.
            ...['up', 'k'].map((key) => ({ key, cmd: () => walkStops(element, -1) })),
          ],
          PARENT,
          { mode: 'focus' },
        )
      }}
    >
      <For each={props.tabs}>
        {(tab) => (
          // `height={1}`, because a wrapped flex line is as tall as its tallest child and a child
          // with no height of its own takes the container's, which draws the second row of tabs three
          // rows below the first.
          <box flexShrink={0} height={1}>
            <Line
              role={props.active === tab.id ? 'strong' : 'body'}
              tone={props.active === tab.id ? 'accent' : undefined}
            >
              {props.active === tab.id ? `[${labelOf(tab)}]` : labelOf(tab)}
              {tab.count === undefined ? '' : ` ${tab.count}`}
            </Line>
          </box>
        )}
      </For>
      <box flexGrow={1} />
      {slot(props.actions ?? props.children)}
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
  scrollOffset?: number
  padding?: 'pane'
  onChange?: (offset: number) => void
}) {
  return (
    <ScrollViewport
      visible={props.active === props.id}
      scrollOffset={props.scrollOffset}
      onChange={props.onChange}
      onBox={(box) => registerPanel(props.idPrefix, box)}
    >
      {props.children}
    </ScrollViewport>
  )
}
/** One line of tab labels with a `×` on the current one. */
export function DocumentTabs(props: {
  tabs: readonly {
    id: string
    label: string
    dirty?: boolean
    status?: 'ok' | 'warn' | 'muted'
    ephemeral?: boolean
    pending?: boolean
    title?: string
    fileStatus?: { letter: string; label: string; tone: 'muted' | 'ok' | 'accent' | 'danger' }
    marks?: readonly { tone: 'muted' | 'warn' | 'danger'; label: string; icon?: string }[]
  }[]
  active: string
  onActivate: (id: string) => void
  onClose?: (id: string) => void
  onPromote?: (id: string) => void
  menu?: (id: string, control?: { open: () => boolean; onOpenChange: (open: boolean) => void }) => JSX.Element
  actions?: JSX.Element
  idPrefix: string
  ariaLabel: string
  /** DOM pane-header geometry; terminal tabs remain one text row. */
  level?: 'pane'
}) {
  const [menuOpen, setMenuOpen] = createSignal(false)
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
    // Editor exposes an action target independent of the document. Terminal session tabs keep
    // their established select-on-arrow behavior because they do not supply a menu.
    selectOnMove: !props.menu,
    selected: () => props.active,
    onSelect: (id) => props.onActivate(id),
    land: () => {},
    onItem: () => false,
  })
  const control = stop({
    on: {
      ...Object.fromEntries(COLLECTION_INTENTS.map((intent) => [intent, () => keys.handle(intent)])),
      menu: () => {
        if (!props.menu || !keys.active()) return false
        setMenuOpen(true)
        return true
      },
      // The collection declines `activate` because `onItem` is false — there is no per-tab renderable
      // to stand on — so Enter is answered here: it re-opens whatever the caret is already on, which
      // is how a reader gets back to the document after walking away from it.
      activate: () => {
        props.onActivate(keys.active() ?? props.active)
        return true
      },
      delete: () => {
        if (!props.onClose) return false
        props.onClose(props.active)
        return true
      },
    } as Partial<Record<Intent, () => boolean>>,
  })
  return (
    <box
      flexDirection="column"
      ref={(element: Renderable) => {
        control.ref(element)
        markEntry(element)
      }}
    >
      <box flexDirection="row" gap={2}>
        {/* The caret every collection draws, for the reason the pane strip gives: the current tab is
          already marked, and a mark that means two things means neither (../chrome/PaneRow.tsx). */}
        <Line tone="accent">{control.focused() ? '\u203a' : ' '}</Line>
        <For each={props.tabs}>
          {(tab) => (
            <>
              <box
                flexDirection="row"
                height={1}
                flexShrink={0}
                ref={(element: Renderable) => {
                  // A normal click still opens the document. The separate action mark below targets an
                  // inactive tab without opening it, matching the desktop's per-tab menu button.
                  element.onMouseDown = () => {
                    if (props.menu) keys.goTo(tab.id)
                    props.onActivate(tab.id)
                  }
                  onCleanup(() => {
                    element.onMouseDown = undefined
                  })
                }}
              >
                <Line
                  role={props.active === tab.id ? 'strong' : 'body'}
                  tone={tab.dirty ? 'accent' : tab.status === 'warn' ? 'warn' : undefined}
                >
                  {props.menu && keys.active() === tab.id ? '›' : ''}
                  {tab.label}
                  {tab.fileStatus ? ` [${tab.fileStatus.letter}]` : ''}
                </Line>
                {/* Other sources' marks, as the desktop draws them: up to three, toned by severity, with
                every label in the legend after the strip. Always dots, because a terminal has a glyph
                for only some icon names. */}
                <For each={tab.marks?.slice(0, 3)}>
                  {(mark) => <Line tone={mark.tone}>{mark.tone === 'muted' ? ' ○' : ' ●'}</Line>}
                </For>
                <Line
                  role={props.active === tab.id ? 'strong' : 'body'}
                  tone={tab.dirty ? 'accent' : tab.status === 'warn' ? 'warn' : undefined}
                >
                  {tab.dirty ? ' ●' : ''}
                  {props.active === tab.id && props.onClose ? ' ×' : ''}
                </Line>
              </box>
              {props.menu && (
                <box
                  height={1}
                  flexShrink={0}
                  ref={(element: Renderable) => {
                    element.onMouseDown = () => {
                      keys.goTo(tab.id)
                      setMenuOpen(true)
                    }
                    onCleanup(() => {
                      element.onMouseDown = undefined
                    })
                  }}
                >
                  <Line tone="muted"> ⋯ </Line>
                </box>
              )}
            </>
          )}
        </For>
        <Line role="muted">
          {(() => {
            const tab = props.tabs.find((candidate) => candidate.id === props.active)
            return [tab?.fileStatus?.label, ...(tab?.marks ?? []).map((mark) => mark.label)].filter(Boolean).join(' · ')
          })()}
        </Line>
        <box flexGrow={1} />
        {slot(props.actions)}
      </box>
      {/* A closed Menu has its own focus stop. Mount it only when invoked so region entry lands on
          this strip and its Left/Right/Shift+F10 keys can target inactive tabs. */}
      {props.menu && menuOpen() && keys.active() ? (
        <box flexDirection="row">
          {slot(
            props.menu(keys.active()!, {
              open: menuOpen,
              onOpenChange: (open) => {
                setMenuOpen(open)
                if (!open) scheduleSettle()
              },
            }),
          )}
        </box>
      ) : null}
    </box>
  )
}
