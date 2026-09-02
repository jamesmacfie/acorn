/** @jsxImportSource @opentui/solid */
import type { ScrollBoxRenderable } from '@opentui/core'
import { createEffect, onCleanup, type JSX } from 'solid-js'
import { registerIntentLayer } from '@acorn/client-core/kit/keys/keymapHost.ts'
import type { Intent } from '@acorn/client-core/kit/keys/intents.ts'
import { bindKeys } from '../keys/install'
import { scheduleSettle } from '../keys/regions'
import { PANE } from '../keys/tiers'

// A constrained document viewport.
//
// OpenTUI's `overflow="scroll"` is a yoga/clipping instruction only. `scrollbox` is the renderable
// that owns an offset, a visible bar and terminal mouse-wheel input. It belongs here, at the content
// viewport, rather than around a whole pane: the pane contains width-sensitive layouts and a free
// sized pane wrapper makes those layouts measure a width that is not on screen (../chrome/PaneRow.tsx).

// The arrows, while the viewport itself is the stop. It only is one where it holds no other stop
// (../keys/regions.ts § stopsIn), so these fire exactly where nothing better could have: a document of
// text with no controls in it.
const KEY_SCROLLS: readonly { key: string; move: (box: ScrollBoxRenderable) => void }[] = [
  { key: 'up', move: (box) => box.scrollBy(-1 / 5, 'viewport') },
  { key: 'k', move: (box) => box.scrollBy(-1 / 5, 'viewport') },
  { key: 'down', move: (box) => box.scrollBy(1 / 5, 'viewport') },
  { key: 'j', move: (box) => box.scrollBy(1 / 5, 'viewport') },
]

// The page group, wherever the keys are inside the viewport. Focus-within rather than focus, because
// the reader who most needs it is standing on a control halfway down a long panel and wants to see
// the rest of the panel without giving up their place: arrows move between stops, page keys scroll
// (docs/tui.md § Scrolling viewports).
const PAGE_KEYS: Partial<Record<Intent, (box: ScrollBoxRenderable) => void>> = {
  pagePrev: (box) => box.scrollBy(-1 / 2, 'viewport'),
  pageNext: (box) => box.scrollBy(1 / 2, 'viewport'),
  first: (box) => box.scrollTo(0),
  last: (box) => box.scrollTo(Math.max(0, box.scrollHeight - box.viewport.height)),
}
/** A vertically scrolling document/detail region with a native bar and wheel/trackpad handling. */
export function ScrollViewport(props: {
  children: JSX.Element
  visible?: boolean
  onBox?: (box: ScrollBoxRenderable) => void
}) {
  // A hidden viewport is one of the two ways the keys can go off screen without anybody being told,
  // and it is the one a reader meets every day: `TabPanel` is this node, and switching a tab hides the
  // panel rather than unmounting it so the panel keeps its state. `visible` is per node in OpenTUI, so
  // setting it false here blurs this box and leaves a focused descendant of it reporting itself
  // focused and visible. Asking for a landing pass is the whole fix, because the pass already walks
  // the parents before it decides who can still hold the keys. No microtask of its own:
  // `scheduleSettle` owns the one there is, and the kit is held to none
  // (../keys/regions.ts § The landing rule, ../invariants.test.ts).
  createEffect(() => {
    if (props.visible === false) scheduleSettle()
  })
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
      ref={(element: ScrollBoxRenderable) => {
        // Native wheel/trackpad input is owned by ScrollBoxRenderable. The keymap is Acorn's, so the
        // keyboard half is registered on the viewport's exact-focus tier rather than bypassing the
        // shared dispatcher with `onKeyDown`.
        bindKeys(element, KEY_SCROLLS.map(({ key, move }) => ({
          key,
          cmd: () => { move(element); return true },
        // Both layers on the pane's own tier, below the collection: a list inside a viewport
        // answers Home and the arrows first, which is what a reader in a list means by them
        // (../keys/tiers.ts).
        })), PANE, { mode: 'focus' })
        onCleanup(registerIntentLayer(element, Object.keys(PAGE_KEYS) as Intent[], (intent) => {
          const move = PAGE_KEYS[intent]
          if (!move) return false
          move(element)
          return true
        }, { priority: PANE, mode: 'focus-within' }))
        props.onBox?.(element)
      }}
    >
      {props.children}
    </scrollbox>
  )
}
