import { createUniqueId, For, Show, splitProps, type ComponentProps, type JSX } from 'solid-js'
import { cx } from '../../kit/lib/cx'
import Icon from '../../kit/components/content/Icon'
import { StatusDot } from '../../kit/components/primitives'
import { resolveRailMarkers, type RailMarker, type RailTone } from './railMarkers'
import { railDotProps } from '../../kit/lib/displayMeta'
import './tabrail.css'

/* The square icon control both rails are made of: the workspace rail down the left and the task
   pane switcher down the right. Deliberately not a Button. A rail control hovers by changing its
   icon and background only, while `.ui-btn:hover` also moves `border-color`, which lit up the
   control's own dividers on the right-hand rail and made the two sides look unrelated.

   It is presentation only. It takes a glyph, a state, and already-resolved status markers; it never
   reads task state, asks a registry anything, or knows which rail it is in. See
   docs/ui-design.md § Rail controls. */

export type RailTabProps = Omit<ComponentProps<'button'>, 'children' | 'color'> & {
  /** The control's name, in words. Becomes both the tooltip title and the accessible name. */
  label: string
  /** An Icon name. Unknown names fall through to Icon's text rendering, which is how `>_` works. */
  glyph?: string
  active?: boolean
  tone?: RailTone
  /** The validated project colour, as a scoped custom property. Not for warning or failure states. */
  accent?: string
  /** Work in flight: swap the glyph for a spinner and refuse activation, staying hoverable. */
  busy?: boolean
  busyLabel?: string
  /** A second line under the glyph, for run targets. */
  sublabel?: JSX.Element
  markers?: readonly RailMarker[]
  /** Escape hatch for a genuinely compound centre. Prefer `glyph` plus `sublabel`. */
  children?: JSX.Element
}

export function RailTab(props: RailTabProps) {
  const [own, rest] = splitProps(props, [
    'class', 'children', 'label', 'glyph', 'active', 'tone', 'accent',
    'busy', 'busyLabel', 'sublabel', 'markers', 'onClick', 'style', 'classList',
  ])
  const tipLabel = () => (own.busy && own.busyLabel ? own.busyLabel : own.label)
  const resolved = () => resolveRailMarkers(own.markers ?? [])
  const legend = () => resolved().legend
  const describedBy = createUniqueId()

  // Not `disabled` while busy: a disabled button swallows the mouseover the tooltip needs, and the
  // archive control deliberately stays hoverable and focusable while its teardown runs.
  const onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    if (own.busy) return
    const handler = own.onClick
    if (typeof handler === 'function') handler(event)
    else if (handler) handler[0](handler[1], event)
  }

  return (
    <button
      {...rest}
      type={props.type ?? 'button'}
      class={cx('tabrail-tab', own.class)}
      classList={{ active: !!own.active, ...(own.classList ?? {}) }}
      style={own.accent ? { '--rail-accent': own.accent, ...(typeof own.style === 'object' ? own.style : {}) } : own.style}
      data-tone={own.tone && own.tone !== 'neutral' ? own.tone : undefined}
      data-tip={tipLabel()}
      data-tip-legend={legend().length ? JSON.stringify(legend()) : undefined}
      aria-label={tipLabel()}
      aria-busy={own.busy || undefined}
      aria-describedby={legend().length ? describedBy : undefined}
      onClick={onClick}
    >
      <Show when={own.busy} fallback={<Show when={own.glyph}>{(name) => <Icon name={name()} />}</Show>}>
        <Icon name="loader-circle" spin />
      </Show>
      {own.children}
      <Show when={own.sublabel}>{(text) => <span class="tabrail-tab-sub">{text()}</span>}</Show>
      {/* Markers live inside the button so it stays the component's single DOM root: menu anchoring,
          drag wrappers, and focus return all measure that one element. They take no pointer events,
          so they never steal the click. */}
      <For each={resolved().placed}>
        {(marker) => (
          <span
            class="tabrail-marker"
            data-pos={marker.position}
            data-tone={marker.tone}
            aria-hidden="true"
          >
            <Show when={marker.icon} fallback={<Show when={marker.dotTone}>{(tone) => <StatusDot {...railDotProps(tone())} pulse={marker.busy} />}</Show>}>
              {(name) => <Icon name={name()} spin={marker.busy} />}
            </Show>
          </span>
        )}
      </For>
      {/* The states, in words, without changing the button's accessible name. */}
      <Show when={legend().length}>
        <span id={describedBy} class="sr-only">{legend().map((item) => item.l).join('. ')}</span>
      </Show>
    </button>
  )
}
