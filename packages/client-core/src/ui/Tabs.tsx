import { For, Show, type JSX } from 'solid-js'
import { cx } from './cx'

export type TabDef = { id: string; label: string; count?: number }

// Reusable tab strip (roles + arrow-key nav). Renders only the tablist and drives the active id;
// the panels are the caller's. Panel ids are `${idPrefix}-panel-${id}` and tab ids
// `${idPrefix}-tab-${id}` so callers can wire aria-labelledby back. Extracted from the Rollbar
// item panel; also used by the +TASK create/attach modal.
export function Tabs(props: {
  tabs: readonly TabDef[]
  active: string
  onChange: (id: string) => void
  idPrefix: string
  ariaLabel: string
  /** Trailing controls beside the strip. Two consumers were overriding `.ui-tabs` to get this. */
  actions?: JSX.Element
  class?: string
}) {
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const current = props.tabs.findIndex((t) => t.id === props.active)
    const offset = event.key === 'ArrowRight' ? 1 : -1
    const next = props.tabs[(current + offset + props.tabs.length) % props.tabs.length]
    props.onChange(next.id)
    document.getElementById(`${props.idPrefix}-tab-${next.id}`)?.focus()
  }

  return (
    <div class={cx('ui-tabs', props.class)} role="tablist" aria-label={props.ariaLabel} onKeyDown={onKeyDown}>
      <For each={props.tabs}>{(t) => (
        <button
          id={`${props.idPrefix}-tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={props.active === t.id}
          aria-controls={`${props.idPrefix}-panel-${t.id}`}
          tabindex={props.active === t.id ? 0 : -1}
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
 *  position and its in-flight state across a tab switch. */
Tabs.Panel = (props: { idPrefix: string; id: string; active: string; class?: string; children: JSX.Element }) => (
  <section
    id={`${props.idPrefix}-panel-${props.id}`}
    class={cx('ui-tab-panel', props.class)}
    role="tabpanel"
    aria-labelledby={`${props.idPrefix}-tab-${props.id}`}
    hidden={props.active !== props.id}
  >
    {props.children}
  </section>
)
