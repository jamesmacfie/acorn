import { For, Show } from 'solid-js'

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
    <div class="ui-tabs" role="tablist" aria-label={props.ariaLabel} onKeyDown={onKeyDown}>
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
    </div>
  )
}
