import { For, Show, type JSX } from 'solid-js'
import { createCollection } from '../../keys/collection'

export type TabDef = { id: string; label: string; count?: number }

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
  /** Trailing controls beside the strip. Two consumers were overriding `.ui-tabs` to get this. */
  actions?: JSX.Element
}) {
  const collection = createCollection({
    id: () => props.idPrefix,
    items: () => props.tabs.map((tab) => ({ key: tab.id, label: tab.label })),
    itemId: (key) => `${props.idPrefix}-tab-${key}`,
    role: 'tablist',
    orientation: 'horizontal',
    selectOnMove: true,
    selected: () => props.active,
    onSelect: (id) => props.onChange(id),
  })

  return (
    <div class="ui-tabs" aria-label={props.ariaLabel} {...collection.containerProps}>
      <For each={props.tabs}>{(t) => (
        <button
          {...collection.itemProps(t.id)}
          type="button"
          aria-selected={props.active === t.id}
          aria-controls={`${props.idPrefix}-panel-${t.id}`}
          class="ui-tab"
          classList={{ active: props.active === t.id }}
          onClick={() => props.onChange(t.id)}
        >
          {t.label}
          <Show when={t.count != null}><span class="ui-tab-count">{t.count}</span></Show>
        </button>
      )}</For>
      <Show when={props.actions}><span class="ui-tabs-actions">{props.actions}</span></Show>
    </div>
  )
}

/** The panel half. Six attributes that have to agree with the strip's ids, hand-written twice in the
 *  rollbar frame before this existed. `hidden` rather than unmounting, so a panel keeps its scroll
 *  position and its in-flight state across a tab switch.
 *
 *  A name of its own as well as `Tabs.Panel`, because a remote tree names one type per node and has
 *  nowhere to put the dot. */
export const TabPanel = (props: { idPrefix: string; id: string; active: string; children: JSX.Element }) => (
  <section
    id={`${props.idPrefix}-panel-${props.id}`}
    class="ui-tab-panel"
    role="tabpanel"
    aria-labelledby={`${props.idPrefix}-tab-${props.id}`}
    hidden={props.active !== props.id}
  >
    {props.children}
  </section>
)

Tabs.Panel = TabPanel
