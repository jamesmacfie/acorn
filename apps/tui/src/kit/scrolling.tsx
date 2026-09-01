/** @jsxImportSource @opentui/solid */
import type { MouseEvent, ScrollBoxRenderable } from '@opentui/core'
import type { JSX } from 'solid-js'
import { bindKeys } from '../keys/install'
import { focusRenderable } from '../keys/regions'

// A constrained document viewport.
//
// OpenTUI's `overflow="scroll"` is a yoga/clipping instruction only. `scrollbox` is the renderable
// that owns an offset, a visible bar and terminal mouse-wheel input. It belongs here, at the content
// viewport, rather than around a whole pane: the pane contains width-sensitive layouts and a free
// sized pane wrapper makes those layouts measure a width that is not on screen (../chrome/PaneRow.tsx).

const KEY_SCROLLS: readonly { key: string; move: (box: ScrollBoxRenderable) => void }[] = [
  { key: 'up', move: (box) => box.scrollBy(-1 / 5, 'viewport') },
  { key: 'k', move: (box) => box.scrollBy(-1 / 5, 'viewport') },
  { key: 'down', move: (box) => box.scrollBy(1 / 5, 'viewport') },
  { key: 'j', move: (box) => box.scrollBy(1 / 5, 'viewport') },
  { key: 'pageup', move: (box) => box.scrollBy(-1 / 2, 'viewport') },
  { key: 'pagedown', move: (box) => box.scrollBy(1 / 2, 'viewport') },
  { key: 'home', move: (box) => box.scrollTo(0) },
  { key: 'end', move: (box) => box.scrollTo(Math.max(0, box.scrollHeight - box.viewport.height)) },
]

/** A vertically scrolling document/detail region with a native bar and wheel/trackpad handling. */
export function ScrollViewport(props: {
  children: JSX.Element
  visible?: boolean
  onBox?: (box: ScrollBoxRenderable) => void
}) {
  let viewport: ScrollBoxRenderable | undefined
  return (
    <scrollbox
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      width="100%"
      minWidth={0}
      minHeight={0}
      scrollX={false}
      scrollY
      visible={props.visible ?? true}
      contentOptions={{ flexDirection: 'column', minWidth: '100%', maxWidth: '100%' }}
      onMouseDown={(event: MouseEvent) => {
        // OpenTUI can focus a clicked renderable, but Acorn's region store cannot observe browser-like
        // `focusin`. Bridge the click at the viewport that owns the pointer event so Escape, borders
        // and keyboard reveal all agree about where the keys went.
        const target = event.target?.focusable ? event.target : viewport
        focusRenderable(target ?? undefined)
      }}
      ref={(element: ScrollBoxRenderable) => {
        viewport = element
        // Native wheel/trackpad input is owned by ScrollBoxRenderable. The keymap is Acorn's, so the
        // keyboard half is registered on the viewport's exact-focus tier rather than bypassing the
        // shared dispatcher with `onKeyDown`.
        bindKeys(element, KEY_SCROLLS.map(({ key, move }) => ({
          key,
          cmd: () => { move(element); return true },
        })), 30, { mode: 'focus' })
        props.onBox?.(element)
      }}
    >
      {props.children}
    </scrollbox>
  )
}
