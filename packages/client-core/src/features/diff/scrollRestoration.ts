import { onCleanup, type Accessor } from 'solid-js'
import type { DiffLayout } from './diffLayout'
import { diffScroll, rememberDiffScroll, type DiffScrollState, type DiffViewScope } from './viewState'

type DiffScrollRestorationOptions = {
  scope: DiffViewScope
  viewMode: () => DiffScrollState['viewMode']
  filesSignature: () => string
  selectedPath: () => string
  scrollEl: Accessor<HTMLDivElement | undefined>
  setScrollEl: (element: HTMLDivElement) => void
  layout: Pick<DiffLayout, 'attach' | 'goTo' | 'onScroll' | 'place' | 'scrollToOffset'>
}

// Where the reader was in this diff, kept for the session and put back when they return
// (docs/diff-rendering.md § Review threads and state).
//
// The place is an identity, not a pixel offset (./diffLayout.ts): the item the viewport started in and
// how far into its code rows, or the thread it started in and how far into that. The layout is exact
// from the topology, so a place is put back as soon as the topology and the scroller both exist, and
// the corrections that follow as threads are measured keep it there.
export function createDiffScrollRestoration(options: DiffScrollRestorationOptions) {
  let publishFrame = 0
  let pending: DiffScrollState | null = null
  let left = 0
  let hasCurrentPosition = false

  const remember = () => {
    const place = options.layout.place()
    if (!place) return
    rememberDiffScroll(options.scope, {
      place,
      left,
      viewMode: options.viewMode(),
      filesSignature: options.filesSignature(),
    })
  }
  const onScroll = (element: HTMLDivElement) => {
    const cause = options.layout.onScroll(element)
    left = element.scrollLeft
    // The reader moved before the saved place could be put back: where they went wins.
    if (pending && cause === 'reader') pending = null
    if (!pending) {
      hasCurrentPosition = true
      remember()
    }
  }
  /** Put a pending place back, once there is a layout to put it against. */
  const retry = () => {
    const element = options.scrollEl()
    if (!element || !pending || !options.layout.goTo(pending.place)) return
    element.scrollLeft = pending.left
    left = element.scrollLeft
    pending = null
    hasCurrentPosition = true
    remember()
  }
  const reset = (rememberReset = false) => {
    pending = null
    left = 0
    hasCurrentPosition = rememberReset
    options.layout.scrollToOffset(0)
    const element = options.scrollEl()
    if (element) element.scrollLeft = 0
    if (rememberReset) remember()
  }
  const prepare = () => {
    const saved = diffScroll(options.scope)
    if (
      !options.selectedPath()
      && saved
      && saved.viewMode === options.viewMode()
      && saved.filesSignature === options.filesSignature()
    ) {
      pending = saved
      retry()
      return
    }
    if (saved && saved.filesSignature !== options.filesSignature()) {
      reset(true)
      return
    }
    // Explicit file navigation wins. A mode mismatch can be the prefs query settling from its
    // default, so do not overwrite the other mode's saved place unless the user scrolls.
    reset()
  }
  const publish = (element: HTMLDivElement) => {
    cancelAnimationFrame(publishFrame)
    publishFrame = requestAnimationFrame(() => {
      options.setScrollEl(element)
      options.layout.attach(element)
      prepare()
    })
  }

  onCleanup(() => {
    cancelAnimationFrame(publishFrame)
    if (!pending && hasCurrentPosition) remember()
  })

  return { onScroll, publish, reset, retry }
}
