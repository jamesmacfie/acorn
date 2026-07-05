import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import './rail-tips.css'

// One fixed-position tooltip for both icon rails. Driven by `data-tip` (+ optional `data-tip-sub`)
// attributes via event delegation — a singleton so nothing per-button, and `position: fixed` so it
// escapes the left rail's scrolling list (which clips absolutely-positioned children). Side is auto:
// the right rail (`.pane-switcher`) flies left, everything else flies right.
// `anchor` is the CSS offset for the side the bubble is pinned to: `left` when flying right off the
// left rail, `right` when flying left off the right rail. Anchoring with `right` (rather than `left`
// + a transform) is what gives the bubble real layout width instead of squeezing it to the edge.
type Tip = { title: string; sub?: string; key?: string; anchor: number; y: number; side: 'left' | 'right' }

export default function RailTips() {
  const [tip, setTip] = createSignal<Tip | null>(null)

  const show = (el: HTMLElement) => {
    const title = el.getAttribute('data-tip')
    if (!title) return
    const rect = el.getBoundingClientRect()
    const side = el.closest('.pane-switcher') ? 'left' : 'right'
    setTip({
      title,
      sub: el.getAttribute('data-tip-sub') ?? undefined,
      key: el.getAttribute('data-tip-key') ?? undefined,
      anchor: side === 'right' ? rect.right + 8 : window.innerWidth - rect.left + 8,
      y: rect.top + rect.height / 2,
      side,
    })
  }

  const tipEl = (t: EventTarget | null) =>
    t instanceof Element ? (t.closest('[data-tip]') as HTMLElement | null) : null

  const onOver = (e: MouseEvent) => {
    const el = tipEl(e.target)
    if (el) show(el)
  }
  const onOut = (e: MouseEvent) => {
    // Only hide when leaving to something that isn't itself tipped (prevents flicker within a button).
    if (!tipEl(e.relatedTarget)) setTip(null)
  }
  const onFocus = (e: FocusEvent) => {
    const el = tipEl(e.target)
    if (el) show(el)
  }
  const hide = () => setTip(null)

  onMount(() => {
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    // Positions go stale on scroll (the task rail scrolls) — just drop the tip.
    window.addEventListener('scroll', hide, true)
  })
  onCleanup(() => {
    document.removeEventListener('mouseover', onOver)
    document.removeEventListener('mouseout', onOut)
    document.removeEventListener('focusin', onFocus)
    document.removeEventListener('focusout', hide)
    window.removeEventListener('scroll', hide, true)
  })

  return (
    <Show when={tip()}>
      {(t) => (
        <div
          class="rail-tip"
          style={{
            [t().side === 'right' ? 'left' : 'right']: `${t().anchor}px`,
            top: `${t().y}px`,
          }}
        >
          <span class="rail-tip-title">
            {t().title}
            <Show when={t().key}>
              <kbd class="rail-tip-key">{t().key}</kbd>
            </Show>
          </span>
          <Show when={t().sub}>
            <span class="rail-tip-sub">{t().sub}</span>
          </Show>
        </div>
      )}
    </Show>
  )
}
