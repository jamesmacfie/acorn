import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import Icon from './Icon'
import { Kbd, StatusDot } from './primitives'
import type { RailStatusItem } from '../tasks/railStatus'
import './tips.css'

// The app's tooltip contract: four data attributes, honoured on any element anywhere. See
// docs/ui-design.md § Tooltips for the attributes, why they replace a wrapper component, and the
// positioning rules.
//
// A legend row mirrors one rail status marker: its glyph (`g`) or StatusDot tone (`d`), a colour
// tone (`t`), and its meaning (`l`). Serialised into `data-tip-legend` by the rail; see
// railStatus.ts.
type LegendItem = { g?: string; d?: RailStatusItem['dotTone']; t?: 'accent' | 'warn' | 'del'; l: string }
type Tip = { title: string; sub?: string; key?: string; legend?: LegendItem[]; anchor: number; y: number; side: 'left' | 'right' }

/** The attribute set, typed, so call sites get completion instead of guessing the spelling. */
export const tip = (text: string, opts?: { sub?: string; key?: string }) => ({
  'data-tip': text,
  ...(opts?.sub === undefined ? {} : { 'data-tip-sub': opts.sub }),
  ...(opts?.key === undefined ? {} : { 'data-tip-key': opts.key }),
})

// Our own attribute, but JSON.parse can still throw on a malformed value. Never let that kill the
// tip.
function parseLegend(raw: string | null): LegendItem[] | undefined {
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
    // Positions go stale on scroll (the task rail scrolls); just drop the tip.
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
              <Kbd class="rail-tip-key" size="xs">{t().key}</Kbd>
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
                        {(tone) => <StatusDot tone={tone()} />}
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
