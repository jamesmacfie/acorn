import { children, createEffect, For, on, onCleanup, Show, type JSX } from 'solid-js'
import Icon from '../content/Icon'
import { createCollection } from '../../keys/collection'
import { revealActiveTab, trackTabOverflow } from './tabScroll'

export type TabDef = {
  id: string
  label: string
  count?: number
  /** A Lucide name, drawn before the label. For a strip whose labels are numbers and whose tabs
   *  differ by kind: github's pull strip labels every tab `#1234` and marks the related ones. */
  icon?: string
  /** The tip on hover and focus, where the label alone does not say what the tab is. */
  title?: string
}

// Reusable tab strip. Renders only the tablist and drives the active id; the panels are the
// caller's. Panel ids are `${idPrefix}-panel-${id}` and tab ids `${idPrefix}-tab-${id}` so callers
// can wire aria-labelledby back. Extracted from the Rollbar item panel; also used by the create-task
// modal and by the `tabs` layout.
//
// A collection, so the arrows, Home, End and type-ahead come from ../keys/collection.ts rather than
// from a key handler here. Selection follows focus, which is what a tab strip means.
export function Tabs(props: {
  tabs: readonly TabDef[]
  active: string
  onChange: (id: string) => void
  idPrefix: string
  ariaLabel: string
  /** A strip that is the pane's header rather than navigation below one. */
  level?: 'pane'
  /** Trailing controls beside the strip. Two consumers were overriding `.ui-tabs` to get this. */
  actions?: JSX.Element
  /** The same trailing slot, spelled the way a remote tree can: a tree's props are data, so its
   *  controls arrive as child nodes (docs/plugins/tree-contract.md § Nodes). */
  children?: JSX.Element
}) {
  // A tree host always hands over its node's children, so an empty list is the common case and must
  // not draw an empty, padded actions box.
  const trailing = children(() => props.actions ?? props.children)
  let stripRef: HTMLDivElement | undefined
  // A remote tree's props arrive one at a time and the host drops a bad one on its own, so this node
  // has to survive arriving without its list rather than throw and take the whole region with it.
  const tabs = (): readonly TabDef[] => props.tabs ?? []

  const collection = createCollection({
    id: () => props.idPrefix,
    items: () => tabs().map((tab) => ({ key: tab.id, label: tab.label })),
    itemId: (key) => `${props.idPrefix}-tab-${key}`,
    role: 'tablist',
    orientation: 'horizontal',
    selectOnMove: true,
    selected: () => props.active,
    onSelect: (id) => props.onChange(id),
  })

  const bindStrip = (element: HTMLDivElement) => {
    stripRef = element
    trackTabOverflow(element)
    const attachCollection = collection.containerProps.ref as (element: HTMLElement) => void
    attachCollection(element)
  }

  createEffect(() => {
    const active = props.active
    if (tabs().some((tab) => tab.id === active)) revealActiveTab(stripRef, `${props.idPrefix}-tab-${active}`)
  })

  return (
    <div class="ui-tabs" data-level={props.level}>
      <div
        class="ui-tab-scroll ui-tabs-strip"
        aria-label={props.ariaLabel}
        {...collection.containerProps}
        ref={bindStrip}
      >
        <For each={tabs()}>{(t) => (
          <button
            {...collection.itemProps(t.id)}
            type="button"
            aria-selected={props.active === t.id}
            aria-controls={`${props.idPrefix}-panel-${t.id}`}
            class="ui-tab"
            classList={{ active: props.active === t.id }}
            data-tip={t.title}
            onClick={() => props.onChange(t.id)}
          >
            <Show when={t.icon}>{(name) => <Icon name={name()} />}</Show>
            {t.label}
            <Show when={t.count != null}><span class="ui-tab-count">{t.count}</span></Show>
          </button>
        )}</For>
      </div>
      <Show when={trailing.toArray().length}><span class="ui-tabs-actions">{trailing()}</span></Show>
    </div>
  )
}

/** The panel half. Six attributes that have to agree with the strip's ids, hand-written twice in the
 *  rollbar frame before this existed. `hidden` rather than unmounting, so a panel keeps its scroll
 *  position and its in-flight state across a tab switch.
 *
 *  A name of its own as well as `Tabs.Panel`, because a remote tree names one type per node and has
 *  nowhere to put the dot. */
export const TabPanel = (props: {
  idPrefix: string; id: string; active: string; children: JSX.Element
  /** The panel viewport's reading place, owned by the feature showing it. */
  scrollOffset?: number
  /** Inset document content while keeping the strip and footer at the pane edges. */
  padding?: 'pane'
  onChange?: (offset: number) => void
}) => {
  let panel: HTMLElement | undefined
  let restoration: ReturnType<typeof setTimeout> | undefined
  let restoreDeadline: ReturnType<typeof setTimeout> | undefined
  let contentObserver: MutationObserver | undefined
  let restorePending = false
  let lastVisibleOffset = 0
  const stopRestore = () => {
    if (restoration) clearTimeout(restoration)
    if (restoreDeadline) clearTimeout(restoreDeadline)
    contentObserver?.disconnect()
    contentObserver = undefined
    restorePending = false
  }
  const restore = () => {
    if (!panel || props.active !== props.id) return
    const desired = lastVisibleOffset || props.scrollOffset || 0
    panel.scrollTop = desired
    if (panel.scrollTop >= desired || desired === 0) { stopRestore(); return }
    // A remote tree can mount the panel before its result rows arrive. Retry only while
    // content is changing, and retire the observer even if the result shrinks.
    if (!contentObserver) {
      contentObserver = new MutationObserver(restore)
      contentObserver.observe(panel, { childList: true, subtree: true })
      restoreDeadline = setTimeout(stopRestore, 5000)
    }
  }
  createEffect(on(() => [props.active === props.id, props.scrollOffset] as const, ([active, offset], previous) => {
    if (previous && active === previous[0] && offset === previous[1]) return
    stopRestore()
    if (!active && previous?.[0]) {
      if (panel?.scrollTop) lastVisibleOffset = panel.scrollTop
      props.onChange?.(lastVisibleOffset)
    }
    // Remote props can arrive after active. The retained offset is part of the source,
    // so a panel that mounted before receiving it still restores its reading place.
    restorePending = !!active && offset !== undefined
    if (active && offset !== undefined) restoration = setTimeout(restore, 0)
  }))
  onCleanup(stopRestore)
  return <section
    ref={panel}
    id={`${props.idPrefix}-panel-${props.id}`}
    class="ui-tab-panel"
    data-padding={props.padding}
    role="tabpanel"
    aria-labelledby={`${props.idPrefix}-tab-${props.id}`}
    hidden={props.active !== props.id}
    onScroll={(event) => {
      if (props.active !== props.id || event.currentTarget.hidden || restorePending) return
      lastVisibleOffset = event.currentTarget.scrollTop
      props.onChange?.(lastVisibleOffset)
    }}
  >
    {props.children}
  </section>
}

Tabs.Panel = TabPanel
