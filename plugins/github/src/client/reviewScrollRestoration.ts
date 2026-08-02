import { createEffect, on, onCleanup, type Accessor } from 'solid-js'
import {
  rememberReviewDiffScroll,
  rememberReviewNavigatorScroll,
  reviewDiffScroll,
  reviewNavigatorScroll,
  type ReviewDiffScrollPosition,
  type ReviewScrollPosition,
  type ReviewViewScope,
} from './reviewViewState'

// PullDetail renders a fragment inside a host-owned .pane-mid scroller. This controller binds that
// parent without introducing a layout wrapper and retries while async sections make it taller.
export function createNavigatorScrollRestoration(options: {
  scope: Accessor<ReviewViewScope | null>
  trackContent: () => void
}): (root: HTMLDivElement) => void {
  let scrollEl: HTMLElement | undefined
  let scope: ReviewViewScope | null = null
  let position: ReviewScrollPosition = { top: 0, left: 0 }
  let pending: ReviewScrollPosition | null = null
  let restoreFrame = 0
  let releaseFrame = 0
  let applyingRestore = false

  const remember = () => {
    if (scope) rememberReviewNavigatorScroll(scope, position)
  }
  const onScroll = () => {
    if (!scrollEl) return
    position = { top: scrollEl.scrollTop, left: scrollEl.scrollLeft }
    if (pending && !applyingRestore) pending = null
    if (!pending) remember()
  }
  const scheduleRestore = () => {
    if (!scrollEl || !pending) return
    cancelAnimationFrame(restoreFrame)
    restoreFrame = requestAnimationFrame(() => {
      if (!scrollEl || !pending) return
      const target = pending
      applyingRestore = true
      scrollEl.scrollTop = target.top
      scrollEl.scrollLeft = target.left
      position = { top: scrollEl.scrollTop, left: scrollEl.scrollLeft }
      if (scrollEl.scrollHeight - scrollEl.clientHeight >= target.top - 1) {
        pending = null
        remember()
      }
      cancelAnimationFrame(releaseFrame)
      releaseFrame = requestAnimationFrame(() => {
        applyingRestore = false
      })
    })
  }

  createEffect(on(options.scope, (next, previous) => {
    if (previous && !pending) rememberReviewNavigatorScroll(previous, position)
    scope = next
    pending = next ? reviewNavigatorScroll(next) ?? { top: 0, left: 0 } : null
    scheduleRestore()
  }))
  createEffect(() => {
    options.trackContent()
    scheduleRestore()
  })
  onCleanup(() => {
    cancelAnimationFrame(restoreFrame)
    cancelAnimationFrame(releaseFrame)
    scrollEl?.removeEventListener('scroll', onScroll)
    if (!pending) remember()
  })

  return (root) => {
    const next = root.closest<HTMLElement>('.pane-mid')
    if (!next || next === scrollEl) return
    scrollEl?.removeEventListener('scroll', onScroll)
    scrollEl = next
    scrollEl.addEventListener('scroll', onScroll)
    scope = options.scope()
    pending = scope ? reviewNavigatorScroll(scope) ?? { top: 0, left: 0 } : null
    scheduleRestore()
  }
}

type DiffScrollRestorationOptions = {
  scope: ReviewViewScope
  viewMode: () => ReviewDiffScrollPosition['viewMode']
  filesSignature: () => string
  selectedPath: () => string
  scrollEl: Accessor<HTMLDivElement | undefined>
  setScrollEl: (element: HTMLDivElement) => void
  setScrollTop: (top: number) => void
  measure: (mode: ReviewDiffScrollPosition['viewMode']) => void
}

// The virtual diff initially consists of short loading rows, then grows as patches are parsed and
// tokenized. Restoration therefore stays pending and is retried by DiffView after each row-model
// update instead of accepting the browser's temporarily clamped scrollTop.
export function createDiffScrollRestoration(options: DiffScrollRestorationOptions) {
  let publishFrame = 0
  let restoreFrame = 0
  let releaseFrame = 0
  let applyingRestore = false
  let pending: ReviewDiffScrollPosition | null = null
  let position: ReviewScrollPosition = { top: 0, left: 0 }
  let hasCurrentPosition = false

  const remember = () => {
    rememberReviewDiffScroll(options.scope, {
      ...position,
      viewMode: options.viewMode(),
      filesSignature: options.filesSignature(),
    })
  }
  const onScroll = (element: HTMLDivElement) => {
    position = { top: element.scrollTop, left: element.scrollLeft }
    options.setScrollTop(position.top)
    if (pending && !applyingRestore) pending = null
    if (!pending) {
      hasCurrentPosition = true
      remember()
    }
  }
  const retry = () => {
    if (!options.scrollEl() || !pending) return
    cancelAnimationFrame(restoreFrame)
    restoreFrame = requestAnimationFrame(() => {
      const element = options.scrollEl()
      if (!element || !pending) return
      const target = pending
      applyingRestore = true
      element.scrollTop = target.top
      element.scrollLeft = target.left
      position = { top: element.scrollTop, left: element.scrollLeft }
      options.setScrollTop(position.top)
      if (element.scrollHeight - element.clientHeight >= target.top - 1) {
        pending = null
        hasCurrentPosition = true
        remember()
      }
      cancelAnimationFrame(releaseFrame)
      releaseFrame = requestAnimationFrame(() => {
        applyingRestore = false
      })
    })
  }
  const reset = (rememberReset = false) => {
    pending = null
    position = { top: 0, left: 0 }
    hasCurrentPosition = rememberReset
    options.setScrollTop(0)
    const element = options.scrollEl()
    if (element) {
      element.scrollTop = 0
      element.scrollLeft = 0
    }
    if (rememberReset) remember()
  }
  const prepare = () => {
    const saved = reviewDiffScroll(options.scope)
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
    // default, so do not overwrite the other mode's saved position unless the user scrolls.
    reset()
  }
  const publish = (element: HTMLDivElement, mode: ReviewDiffScrollPosition['viewMode']) => {
    cancelAnimationFrame(publishFrame)
    publishFrame = requestAnimationFrame(() => {
      options.setScrollEl(element)
      options.measure(mode)
      prepare()
    })
  }

  onCleanup(() => {
    cancelAnimationFrame(publishFrame)
    cancelAnimationFrame(restoreFrame)
    cancelAnimationFrame(releaseFrame)
    if (!pending && hasCurrentPosition) remember()
  })

  return { onScroll, publish, reset, retry }
}
