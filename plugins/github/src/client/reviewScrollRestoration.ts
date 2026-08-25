import { createEffect, on, onCleanup, type Accessor } from 'solid-js'
import {
  rememberReviewNavigatorScroll,
  reviewNavigatorScroll,
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
