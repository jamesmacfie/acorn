import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import './rail-tips.css'

// One fixed-position tooltip for both icon rails. Driven by `data-tip` (+ optional `data-tip-sub`)
// attributes via event delegation — a singleton so nothing per-button, and `position: fixed` so it
// escapes the left rail's scrolling list (which clips absolutely-positioned children). Side is auto:
// the right rail (`.pane-switcher`) flies left, everything else flies right.
// `anchor` is the CSS offset for the side the bubble is pinned to: `left` when flying right off the
// left rail, `right` when flying left off the right rail. Anchoring with `right` (rather than `left`
// + a transform) is what gives the bubble real layout width instead of squeezing it to the edge.
// A legend row mirrors one rail status marker: its glyph (`g`) or CI dot class (`d`), a colour tone
// (`t`), and its meaning (`l`). Serialised into `data-tip-legend` by the rail; see railStatus.ts.
type LegendItem = { g?: string; d?: string; t?: 'accent' | 'warn' | 'del'; l: string }
type Tip = { title: string; sub?: string; key?: string; legend?: LegendItem[]; anchor: number; y: number; side: 'left' | 'right' }

// Our own attribute, but JSON.parse can still throw on a malformed value — never let that kill the tip.
function parseLegend(raw: string | null): LegendItem[] | undefined {
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) && v.length ? v : undefined
  } catch {
    return undefined
  }
}

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
      legend: parseLegend(el.getAttribute('data-tip-legend')),
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
          <Show when={t().legend}>
            <div class="rail-tip-legend">
              <For each={t().legend}>
                {(it) => (
                  <div class="rail-tip-legend-row">
                    <span class="rail-tip-legend-ico" classList={{ [`tone-${it.t}`]: !!it.t }}>
                      <Show when={it.d} fallback={it.g}>
                        <span class={it.d} />
                      </Show>
                    </span>
                    <span class="rail-tip-legend-label">{it.l}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
    </Show>
  )
}
