import { createEffect, For, Show, type JSX } from 'solid-js'
import { cx } from './cx'
import Icon from './Icon'
import { Button, StatusDot } from './primitives'

export type DocTabDef = {
  id: string
  label: string
  /** Unsaved changes — a dot, not an asterisk in the label. */
  dirty?: boolean
  /** Run state, for a tab that owns a process (a terminal session). */
  status?: 'ok' | 'warn' | 'muted'
  /** A preview tab: italic, replaced rather than accumulated. */
  ephemeral?: boolean
  /** Still starting. Renders a pulsing dot, reduced-motion guarded. */
  pending?: boolean
  title?: string
}

// The closable tab strip: editor documents and terminal sessions. Distinct from `Tabs`, which
// switches PANELS within one view — these tabs each own a document, can be closed, and carry state.
//
// Same contract shape as Tabs on purpose (tablist only, panels are the caller's, ids follow the
// `${idPrefix}-tab-${id}` convention) so the two read as siblings.
//
// The close buttons are separate focusables INSIDE each tab, which is what lets a keyboard user
// reach them at all; the terminal's ✕ was mouse-only.
export function DocumentTabs(props: {
  tabs: readonly DocTabDef[]
  active: string
  onActivate: (id: string) => void
  onClose?: (id: string) => void
  /** Double-click. The editor idiom: it promotes an ephemeral preview tab to a kept one. */
  onPromote?: (id: string) => void
  /** Right-pinned slot, after the strip. */
  actions?: JSX.Element
  idPrefix: string
  ariaLabel: string
  class?: string
}) {
  let stripRef: HTMLDivElement | undefined

  // A tab activated by keyboard, or opened off-screen in a long strip, has to be brought into view
  // or the selection is invisible.
  createEffect(() => {
    const id = props.active
    if (!id || !stripRef) return
    queueMicrotask(() => {
      stripRef?.querySelector(`#${CSS.escape(`${props.idPrefix}-tab-${id}`)}`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  })

  const move = (offset: number) => {
    if (!props.tabs.length) return
    const current = props.tabs.findIndex((tab) => tab.id === props.active)
    const next = props.tabs[(current + offset + props.tabs.length) % props.tabs.length]
    props.onActivate(next.id)
    document.getElementById(`${props.idPrefix}-tab-${next.id}`)?.focus()
  }

  return (
    <div class={cx('ui-doctabs', props.class)}>
      <div
        ref={stripRef}
        class="ui-doctabs-strip"
        role="tablist"
        aria-label={props.ariaLabel}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
          else if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
          else if (event.key === 'Delete' && props.onClose) { event.preventDefault(); props.onClose(props.active) }
        }}
      >
        <For each={props.tabs}>{(tab) => (
          <div
            class="ui-doctab"
            data-active={props.active === tab.id ? '' : undefined}
            data-ephemeral={tab.ephemeral ? '' : undefined}
          >
            <button
              id={`${props.idPrefix}-tab-${tab.id}`}
              type="button"
              role="tab"
              class="ui-doctab-label"
              aria-selected={props.active === tab.id}
              aria-controls={`${props.idPrefix}-panel-${tab.id}`}
              tabindex={props.active === tab.id ? 0 : -1}
              title={tab.title ?? tab.label}
              onClick={() => props.onActivate(tab.id)}
              onDblClick={() => props.onPromote?.(tab.id)}
              // Middle-click closes, which is the convention every editor has and none of these had.
              onAuxClick={(event) => {
                if (event.button === 1 && props.onClose) {
                  event.preventDefault()
                  props.onClose(tab.id)
                }
              }}
            >
              <Show when={tab.status || tab.pending}>
                <StatusDot tone={tab.status ?? 'ok'} pulse={tab.pending} />
              </Show>
              <span class="ui-doctab-text">{tab.label}</span>
              <Show when={tab.dirty}>
                <StatusDot class="ui-doctab-dirty" tone="accent" label="Unsaved changes" />
              </Show>
            </button>
            <Show when={props.onClose}>
              <Button
                variant="bare"
                size="sm"
                iconOnly
                class="ui-doctab-close"
                aria-label={`Close ${tab.label}`}
                onClick={() => props.onClose?.(tab.id)}
              >
                <Icon name="x" />
              </Button>
            </Show>
          </div>
        )}</For>
      </div>
      <Show when={props.actions}><span class="ui-doctabs-actions">{props.actions}</span></Show>
    </div>
  )
}
