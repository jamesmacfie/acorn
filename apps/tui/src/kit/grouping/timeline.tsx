/** @jsxImportSource @acorn/tui/jsx */
import { Show, untrack, type Accessor, type JSX } from 'solid-js'
import type { TimelineControls } from '@acorn/client-core/kit/components/content'
import type { ReadingPlace } from '@acorn/client-core/kit/lib'
import { Button } from '../asking/buttons'
import { ScrollViewport, type Viewport } from '../scrolling'
import { spaceLines } from '../roles'
/** Draw turns in sequence. With `follow`, the timeline owns its scrolling and keeps the latest turn
 *  visible while the reader is at the bottom. This leaves adjacent headers and composers pinned.
 *  `place` and `onChange` are accepted for kit parity but this host does not restore turn positions. */
export function Timeline(props: {
  ariaLabel?: string
  follow?: boolean
  place?: () => ReadingPlace
  onChange?: (place: ReadingPlace) => void
  controls?: (api: TimelineControls) => void
  /** Accepted for kit parity; cells do not report rendered-surface health. */
  total?: number
  /** Older turns are offered through a "Show earlier" button. */
  hidden?: number
  onShowEarlier?: () => void
  /** Ignored: this host restores no turn place, so it never has a hidden one to ask for. */
  reveal?: (key: string) => boolean
  /** Ignored: this host does not trim. A window here only grows until the list is drawn again. */
  onTrim?: (key: string) => void
  children: JSX.Element
}) {
  const earlier = () => (
    <Show when={props.hidden}>
      {(hidden) => <Button variant="ghost" size="sm" onPress={() => props.onShowEarlier?.()}>{`Show earlier (${hidden()})`}</Button>}
    </Show>
  )
  if (!props.follow) return <box flexDirection="column" flexGrow={1}>{earlier()}{props.children}</box>
  let view: Viewport | undefined
  // Explicit jumps use scrollTo; stickToBottom only follows arriving turns conditionally.
  props.controls?.({
    toTop: () => view?.scrollTo(0),
    toBottom: () => { if (view) view.scrollTo(Math.max(0, view.scrollHeight - view.viewport.height)) },
  })
  return (
    <ScrollViewport onBox={(box) => { view = box }}>
      {/* Size this box by its turns so follow reacts to content rather than viewport changes. */}
      <box
        flexDirection="column"
        flexShrink={0}
        onSizeChange={() => view?.stickToBottom()}
      >
        {earlier()}
        {props.children}
      </box>
    </ScrollViewport>
  )
}

/** A timeline turn. Terminal rendering treats function children as visible immediately. */
Timeline.Turn = (props: {
  key?: string
  position?: number
  setSize?: number
  children: JSX.Element | ((near: Accessor<boolean>) => JSX.Element)
}) => {
  const content = () => {
    const child = props.children
    if (typeof child !== 'function' || child.length === 0) return child as JSX.Element
    return untrack(() => (child as (near: Accessor<boolean>) => JSX.Element)(() => true))
  }
  return <box flexDirection="column" marginTop={spaceLines('row')}>{content()}</box>
}
