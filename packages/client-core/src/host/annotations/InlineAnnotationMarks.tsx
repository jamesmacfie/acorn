import { createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { AnnotationSeverity, PluginAnnotationKey } from '@acorn/protocol/extensionPoints.ts'
import { StatusDot } from '../../kit/components/content/StatusDot'
import { createAnchoredPopover } from '../../kit/lib/controls/anchor'
import { richTooltipDom } from '../../kit/lib/rendering/richTooltip'
import { extensionPointRegistry } from '../registries/extensionPoints/extensionPoints'
import { pluginLabel } from '../plugins/pluginLabel'
import { annotationsFor, type StampedMark } from './annotations'
import './annotations.css'

// One item's marks on one line, for an owner whose row has room for a dot and a few words rather than
// a block under it, such as the agents plugin's session rows and pane header.
//
// One button for all of an item's marks, so a row gains one tab stop however many plugins marked it.
// It draws up to the point's `max`, and its name and the detail it opens on hover and focus list every
// mark, so a third mark is never lost. Detail goes through `richTooltipDom`, the one sanitizing path
// for plugin content, with the host's credit under it.

const DOT_TONE: Record<AnnotationSeverity, 'muted' | 'warn' | 'danger'> = {
  info: 'muted',
  warn: 'warn',
  danger: 'danger',
}

/** How long the detail stays after the pointer or focus leaves, so the pointer can cross into it and
 *  follow a link. */
const CLOSE_DELAY_MS = 200

export function InlineAnnotationMarks(props: {
  point: string
  itemKey: PluginAnnotationKey
  /** Draw the severity dots without their text, for a list too narrow for words. */
  dotsOnly?: boolean
}) {
  const marks = () => annotationsFor(props.point, props.itemKey)
  const drawn = () => marks().slice(0, extensionPointRegistry.get(props.point)?.max ?? marks().length)
  const name = () =>
    marks()
      .map((mark) => `${mark.text}, from ${pluginLabel(mark.pluginId)}`)
      .join('; ')
  const detailId = createUniqueId()
  const [open, setOpen] = createSignal(false)
  let button: HTMLButtonElement | undefined
  let closing: ReturnType<typeof setTimeout> | undefined
  const show = () => {
    clearTimeout(closing)
    setOpen(true)
  }
  const hide = () => {
    clearTimeout(closing)
    closing = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }
  onCleanup(() => clearTimeout(closing))

  return (
    <Show when={marks().length}>
      <button
        ref={button}
        type="button"
        class="annotation-inline"
        aria-label={name()}
        aria-describedby={open() ? detailId : undefined}
        aria-expanded={open()}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // WebKit doesn't focus a button on click, and a touch screen has no hover.
        onClick={(event) => event.currentTarget.focus()}
      >
        <For each={drawn()}>
          {(mark) => (
            <span class="annotation-inline-mark" data-severity={mark.severity}>
              <StatusDot tone={DOT_TONE[mark.severity]} />
              <Show when={!props.dotsOnly}>
                <span class="annotation-inline-text">{mark.text}</span>
              </Show>
            </span>
          )}
        </For>
      </button>
      <Show when={open() && button}>
        {(anchor) => (
          <MarkDetail
            id={detailId}
            anchor={anchor()}
            marks={marks()}
            onEnter={show}
            onLeave={hide}
            onDismiss={() => setOpen(false)}
          />
        )}
      </Show>
    </Show>
  )
}

/** Mounted only while open, so a long list of marked rows holds no document listeners. */
function MarkDetail(props: {
  id: string
  anchor: HTMLElement
  marks: readonly StampedMark[]
  onEnter: () => void
  onLeave: () => void
  onDismiss: () => void
}) {
  const popover = createAnchoredPopover({
    anchor: () => props.anchor,
    placement: () => 'bottom-start',
    open: () => true,
    onOpenChange: (next) => {
      if (!next) props.onDismiss()
    },
  })
  return (
    <Portal>
      <div
        ref={(el) => popover.setSurface(el)}
        id={props.id}
        role="tooltip"
        class="ui-popover annotation-detail"
        style={popover.surfaceStyle()}
        onMouseEnter={() => props.onEnter()}
        onMouseLeave={() => props.onLeave()}
      >
        <For each={props.marks}>
          {(mark) => (
            <div class="annotation-detail-mark" data-severity={mark.severity}>
              {/* The text heads its detail, because a dots-only row never showed it. */}
              <Show when={mark.detail}>
                <span class="annotation-detail-text">{mark.text}</span>
              </Show>
              {richTooltipDom(mark.detail ?? mark.text, pluginLabel(mark.pluginId))}
            </div>
          )}
        </For>
      </div>
    </Portal>
  )
}
