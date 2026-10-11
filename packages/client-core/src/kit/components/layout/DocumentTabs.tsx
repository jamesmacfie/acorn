import { createEffect, createSignal, For, Show, type JSX } from 'solid-js'
import { IconButton } from '../inputs/IconButton'
import { StatusDot } from '../content/StatusDot'
import Icon from '../content/Icon'
import { revealActiveTab, trackTabOverflow } from './tabScroll'

export type DocTabDef = {
  id: string
  label: string
  /** Unsaved changes: a dot, not an asterisk in the label. */
  dirty?: boolean
  /** Run state, for a tab that owns a process (a terminal session). */
  status?: 'ok' | 'warn' | 'muted'
  /** A preview tab: italic, replaced rather than accumulated. */
  ephemeral?: boolean
  /** Still starting. Renders a pulsing dot, reduced-motion guarded. */
  pending?: boolean
  title?: string
  fileStatus?: { letter: string; label: string; tone: 'muted' | 'ok' | 'accent' | 'danger' }
  /** Facts another source pinned to the document, such as a review note. Up to three glyphs draw;
   *  every label is read out with the tab. */
  marks?: readonly DocTabMark[]
}

type DocTabMark = { tone: 'muted' | 'warn' | 'danger'; label: string; icon?: string }

const MAX_TAB_MARK_GLYPHS = 3

// The closable tab strip: editor documents and terminal sessions. Distinct from `Tabs`, which
// switches panels within one view; these tabs each own a document, can be closed, and carry state.
//
// Same contract shape as `Tabs` (tablist only, panels are the caller's, ids follow the
// `${idPrefix}-tab-${id}` convention), so the two read as siblings.
//
// The close buttons are separate focusables inside each tab, which lets a keyboard user reach them
// at all.
export function DocumentTabs(props: {
  tabs: readonly DocTabDef[]
  active: string
  onActivate: (id: string) => void
  onClose?: (id: string) => void
  /** Double-click. The editor idiom: it promotes an ephemeral preview tab to a kept one. */
  onPromote?: (id: string) => void
  /** Optional caller-owned actions for one tab; the kit does not interpret the id. The tab's own
   *  button opens the same menu on right-click, Shift+F10 and the menu key, without activating it. */
  menu?: (id: string, control?: { open: () => boolean; onOpenChange: (open: boolean) => void }) => JSX.Element
  /** Right-pinned slot, after the strip. */
  actions?: JSX.Element
  idPrefix: string
  ariaLabel: string
  /** A strip that is the pane's header rather than navigation below one. */
  level?: 'pane'
}) {
  let stripRef: HTMLDivElement | undefined

  // A tab activated by keyboard, or opened off-screen in a long strip, has to be brought into view
  // or the selection is invisible.
  createEffect(() => revealActiveTab(stripRef, `${props.idPrefix}-tab-${props.active}`))

  const move = (offset: number) => {
    if (!props.tabs.length) return
    const current = props.tabs.findIndex((tab) => tab.id === props.active)
    const next = props.tabs[(current + offset + props.tabs.length) % props.tabs.length]
    props.onActivate(next.id)
    document.getElementById(`${props.idPrefix}-tab-${next.id}`)?.focus()
  }

  // One open tab menu per strip. When the tab itself opened it, focus goes back to that tab on close,
  // if the tab is still there; the menu's own dismissal would focus its ⋯ button instead.
  const [menuTab, setMenuTab] = createSignal<string | null>(null)
  let openedByTab: string | null = null
  const openFromTab = (id: string) => {
    openedByTab = id
    setMenuTab(id)
  }
  const menuControl = (id: string) => ({
    open: () => menuTab() === id,
    onOpenChange: (open: boolean) => {
      if (open) {
        setMenuTab(id)
        return
      }
      if (menuTab() === id) setMenuTab(null)
      if (openedByTab !== id) return
      openedByTab = null
      queueMicrotask(() => document.getElementById(`${props.idPrefix}-tab-${id}`)?.focus())
    },
  })

  return (
    <div class="ui-doctabs" data-level={props.level}>
      <div
        ref={(element) => {
          stripRef = element
          trackTabOverflow(element)
        }}
        class="ui-tab-scroll ui-doctabs-strip"
        role="tablist"
        aria-label={props.ariaLabel}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            move(1)
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault()
            move(-1)
          } else if (event.key === 'Delete' && props.onClose) {
            event.preventDefault()
            props.onClose(props.active)
          }
        }}
      >
        <For each={props.tabs}>
          {(tab) => (
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
                aria-label={`${tab.label}${tab.fileStatus ? `, ${tab.fileStatus.label}` : ''}${(tab.marks ?? []).map((mark) => `, ${mark.label}`).join('')}${tab.dirty ? ', Unsaved changes' : ''}`}
                aria-selected={props.active === tab.id}
                aria-controls={`${props.idPrefix}-panel-${tab.id}`}
                tabindex={props.active === tab.id ? 0 : -1}
                // The browser's tooltip only for a name the strip cut short; anything more is the app's tip.
                title={tab.title ? undefined : tab.label}
                data-tip={tab.title}
                onClick={() => props.onActivate(tab.id)}
                // A right press would focus the tab and blur the document under it before the menu
                // could hold its writes, so it doesn't move focus at all.
                onMouseDown={(event) => {
                  if (event.button === 2 && props.menu) event.preventDefault()
                }}
                onContextMenu={
                  props.menu
                    ? (event) => {
                        event.preventDefault()
                        openFromTab(tab.id)
                      }
                    : undefined
                }
                onKeyDown={(event) => {
                  if (!props.menu || (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey))) return
                  event.preventDefault()
                  event.stopPropagation()
                  openFromTab(tab.id)
                }}
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
                <span class="ui-doctab-text" data-file-status-tone={tab.fileStatus?.tone}>
                  {tab.label}
                </span>
                <Show when={tab.fileStatus}>
                  <span
                    class="ui-doctab-file-status"
                    data-tone={tab.fileStatus!.tone}
                    title={tab.fileStatus!.label}
                    aria-label={tab.fileStatus!.label}
                  >
                    {tab.fileStatus!.letter}
                  </span>
                </Show>
                <For each={tab.marks?.slice(0, MAX_TAB_MARK_GLYPHS)}>
                  {(mark) => (
                    <Show when={mark.icon} fallback={<StatusDot tone={mark.tone} />}>
                      {(name) => <Icon name={name()} tone={mark.tone} />}
                    </Show>
                  )}
                </For>
                <Show when={tab.dirty}>
                  <StatusDot tone="accent" label="Unsaved changes" />
                </Show>
              </button>
              <Show when={props.onClose}>
                <IconButton icon="x" label={`Close ${tab.label}`} onPress={() => props.onClose?.(tab.id)} />
              </Show>
              <Show when={props.menu}>{props.menu?.(tab.id, menuControl(tab.id))}</Show>
            </div>
          )}
        </For>
      </div>
      <Show when={props.actions}>
        <span class="ui-doctabs-actions">{props.actions}</span>
      </Show>
    </div>
  )
}
