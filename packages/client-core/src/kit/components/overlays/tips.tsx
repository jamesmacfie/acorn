import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import Icon from '../content/Icon'
import { Kbd } from '../content/Kbd'
import { StatusDot } from '../content/StatusDot'
import { railDotProps } from '../../lib/rendering/displayMeta'
import { formatRelativeTime } from '../../lib/rendering/formatRelativeTime'
import type { RailLegendItem } from '../../tokens/rail'
import './tips.css'

// The app's tooltip contract: data attributes, honoured on any element anywhere. See
// docs/ui-design.md § Tooltips for the attributes, why they replace a wrapper component, and the
// positioning rules.
//
// RailTab serialises each marker into `data-tip-legend`; the kit owns the display shape.
type Tip = {
  title: string
  sub?: string
  key?: string
  legend?: RailLegendItem[]
  /** `help` is a sentence or three rather than a label: body weight, and a wider bubble. */
  kind?: string
  anchor: number
  y: number
  side: 'left' | 'right'
}

/** The gap between an element and its bubble. */
const GAP = 8

/* Keep the bubble inside the window. It goes on the side it prefers unless that runs past the edge
   and the other side does not, and its middle moves up or down until the whole bubble is at least
   `--space-4` from the top and the bottom. Measured from the drawn bubble, because its width depends
   on its text. */
function fitTip(rect: DOMRect, preferred: 'left' | 'right', width: number, height: number, margin: number) {
  const fitsRight = rect.right + GAP + width <= window.innerWidth - margin
  const fitsLeft = rect.left - GAP - width >= margin
  const side = preferred === 'right'
    ? (fitsRight || !fitsLeft ? 'right' : 'left')
    : (fitsLeft || !fitsRight ? 'left' : 'right')
  const middle = rect.top + rect.height / 2
  const y = Math.max(margin + height / 2, Math.min(middle, window.innerHeight - margin - height / 2))
  return {
    side,
    anchor: side === 'right' ? rect.right + GAP : window.innerWidth - rect.left + GAP,
    y,
  } as const
}

const edgeMargin = () =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-4')) || GAP

/** The attribute set, typed, so call sites get completion instead of guessing the spelling. */
export const tip = (text: string, opts?: { sub?: string; key?: string; at?: number }) => ({
  'data-tip': text,
  ...(opts?.sub === undefined ? {} : { 'data-tip-sub': opts.sub }),
  ...(opts?.key === undefined ? {} : { 'data-tip-key': opts.key }),
  ...(opts?.at === undefined ? {} : { 'data-tip-at': opts.at }),
})

// Our own attribute, but JSON.parse can still throw on a malformed value. Never let that kill the
// tip.
function parseLegend(raw: string | null): RailLegendItem[] | undefined {
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) && v.length ? v : undefined
  } catch {
    return undefined
  }
}

export default function Tips() {
  const [tip, setTip] = createSignal<Tip | null>(null)
  let bubble: HTMLDivElement | undefined
  // The element the tip belongs to. An element taken out of the page while focused or hovered sends
  // no focusout and no mouseout, so the tip watches for it to go, but only while the tip is up.
  let anchor: HTMLElement | undefined
  let watcher: MutationObserver | undefined

  const hide = () => {
    setTip(null)
    anchor = undefined
    watcher?.disconnect()
    watcher = undefined
  }

  const show = (el: HTMLElement) => {
    const title = el.getAttribute('data-tip')
    if (!title) return
    anchor = el
    if (!watcher) {
      watcher = new MutationObserver(() => {
        if (anchor && !anchor.isConnected) hide()
      })
      watcher.observe(document.body, { childList: true, subtree: true })
    }
    const rect = el.getBoundingClientRect()
    const preferred = el.closest('.pane-switcher') ? 'left' : 'right'
    const rawAt = el.getAttribute('data-tip-at')
    const at = rawAt === null ? NaN : Number(rawAt)
    setTip({
      title,
      sub: Number.isFinite(at) ? formatRelativeTime(at) : el.getAttribute('data-tip-sub') ?? undefined,
      key: el.getAttribute('data-tip-key') ?? undefined,
      legend: parseLegend(el.getAttribute('data-tip-legend')),
      kind: el.getAttribute('data-tip-kind') ?? undefined,
      ...fitTip(rect, preferred, 0, 0, 0),
    })
    // The bubble is drawn by now, so it can be measured and moved before the frame paints.
    if (bubble) {
      const placed = fitTip(rect, preferred, bubble.offsetWidth, bubble.offsetHeight, edgeMargin())
      setTip((current) => (current ? { ...current, ...placed } : current))
    }
  }

  const tipEl = (t: EventTarget | null) =>
    t instanceof Element ? (t.closest('[data-tip]') as HTMLElement | null) : null

  const onOver = (e: MouseEvent) => {
    const el = tipEl(e.target)
    if (el) show(el)
  }
  const onOut = (e: MouseEvent) => {
    // Only hide when leaving to something that isn't itself tipped (prevents flicker within a button).
    if (!tipEl(e.relatedTarget)) hide()
  }
  const onFocus = (e: FocusEvent) => {
    const el = tipEl(e.target)
    if (el) show(el)
  }
  onMount(() => {
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    // Positions go stale on scroll (the task rail scrolls); just drop the tip.
    window.addEventListener('scroll', hide, true)
  })
  onCleanup(() => {
    document.removeEventListener('mouseover', onOver)
    document.removeEventListener('mouseout', onOut)
    document.removeEventListener('focusin', onFocus)
    document.removeEventListener('focusout', hide)
    window.removeEventListener('scroll', hide, true)
    watcher?.disconnect()
  })

  return (
    <Show when={tip()}>
      {(t) => (
        <div
          ref={(el) => { bubble = el }}
          class="rail-tip"
          data-kind={t().kind}
          style={{
            [t().side === 'right' ? 'left' : 'right']: `${t().anchor}px`,
            top: `${t().y}px`,
          }}
        >
          <span class="rail-tip-title">
            {t().title}
            <Show when={t().key}>
              <Kbd size="xs">{t().key}</Kbd>
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
                      <Show when={it.d} fallback={it.g ? <Icon name={it.g} /> : undefined}>
                        {(tone) => <StatusDot {...railDotProps(tone())} />}
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
