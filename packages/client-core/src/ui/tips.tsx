import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import Icon from './Icon'
import { Kbd, StatusDot } from './primitives'
import type { RailStatusItem } from '../tasks/railStatus'
import './tips.css'

// THE APP'S TOOLTIP CONTRACT.
//
// Four attributes, honoured on any element anywhere:
//
//   data-tip         the tip text (required — no attribute, no tip)
//   data-tip-sub     a second, muted line
//   data-tip-key     a keyboard chord, rendered as a key cap
//   data-tip-legend  JSON array of status markers: { g: icon name, d: StatusDot tone,
//                    t: colour tone, l: meaning } — see tasks/railStatus.ts
//
// Attributes rather than a <Tooltip> wrapper component, deliberately: a wrapper adds an element
// around every trigger, which changes layout. This works on plugin-contributed markup, needs no
// per-site listener, and costs one delegated listener for the whole document.
//
// This outgrew the task rail long ago — it was `tooltip/RailTips.tsx`, used by four core surfaces
// and exactly one plugin, while ~50 other sites fell back to native `title=`, which is slow,
// unstyled, and invisible to keyboard users on some platforms. Native `title` remains acceptable
// only where the styled tip cannot reach — inside xterm's canvas, for instance.
//
// A singleton, and `position: fixed` so it escapes the left rail's scrolling list (which clips
// absolutely-positioned children). Side is auto: the right rail (`.pane-switcher`) flies left,
// everything else flies right.
// `anchor` is the CSS offset for the side the bubble is pinned to: `left` when flying right off the
// left rail, `right` when flying left off the right rail. Anchoring with `right` (rather than `left`
// + a transform) is what gives the bubble real layout width instead of squeezing it to the edge.
// A legend row mirrors one rail status marker: its glyph (`g`) or StatusDot tone (`d`), a colour tone
// (`t`), and its meaning (`l`). Serialised into `data-tip-legend` by the rail; see railStatus.ts.
type LegendItem = { g?: string; d?: RailStatusItem['dotTone']; t?: 'accent' | 'warn' | 'del'; l: string }
type Tip = { title: string; sub?: string; key?: string; legend?: LegendItem[]; anchor: number; y: number; side: 'left' | 'right' }

/** The attribute set, typed, so call sites get completion instead of guessing the spelling. */
export const tip = (text: string, opts?: { sub?: string; key?: string }) => ({
  'data-tip': text,
  ...(opts?.sub === undefined ? {} : { 'data-tip-sub': opts.sub }),
  ...(opts?.key === undefined ? {} : { 'data-tip-key': opts.key }),
})

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

/** Frame-side tooltip listener.
 *
 * A sandboxed plugin frame has its own document, so the shell's singleton cannot see its elements and
 * every `data-tip` inside a frame was silently inert. This mounts the same delegated listener and the
 * same bubble markup into a frame's document, the way frames already mount their own copy of the
 * shared CSS. Pure DOM — no shell imports — so it belongs on the frame-safe barrel.
 *
 * Returns a teardown function.
 */
export function mountFrameTips(doc: Document = document): () => void {
  const bubble = doc.createElement('div')
  bubble.className = 'rail-tip'
  bubble.hidden = true
  doc.body.append(bubble)

  const tipEl = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? (target.closest('[data-tip]') as HTMLElement | null) : null

  const hide = () => { bubble.hidden = true }

  const show = (element: HTMLElement) => {
    const title = element.getAttribute('data-tip')
    if (!title) return
    const sub = element.getAttribute('data-tip-sub')
    const key = element.getAttribute('data-tip-key')
    // textContent per node rather than innerHTML: these attributes can carry provider data.
    bubble.replaceChildren()
    const titleRow = doc.createElement('span')
    titleRow.className = 'rail-tip-title'
    titleRow.textContent = title
    if (key) {
      const cap = doc.createElement('kbd')
      cap.className = 'ui-kbd rail-tip-key'
      cap.dataset.size = 'xs'
      cap.textContent = key
      titleRow.append(cap)
    }
    bubble.append(titleRow)
    if (sub) {
      const subRow = doc.createElement('span')
      subRow.className = 'rail-tip-sub'
      subRow.textContent = sub
      bubble.append(subRow)
    }
    // Inside a frame the viewport IS the frame, so there is no rail to fly around: always right.
    const rect = element.getBoundingClientRect()
    bubble.style.left = `${rect.right + 8}px`
    bubble.style.right = ''
    bubble.style.top = `${rect.top + rect.height / 2}px`
    bubble.hidden = false
  }

  const onOver = (event: Event) => {
    const element = tipEl(event.target)
    if (element) show(element)
  }
  const onOut = (event: Event) => {
    if (!tipEl((event as MouseEvent).relatedTarget)) hide()
  }

  doc.addEventListener('mouseover', onOver)
  doc.addEventListener('mouseout', onOut)
  doc.addEventListener('focusin', onOver)
  doc.addEventListener('focusout', hide)
  doc.defaultView?.addEventListener('scroll', hide, true)

  return () => {
    doc.removeEventListener('mouseover', onOver)
    doc.removeEventListener('mouseout', onOut)
    doc.removeEventListener('focusin', onOver)
    doc.removeEventListener('focusout', hide)
    doc.defaultView?.removeEventListener('scroll', hide, true)
    bubble.remove()
  }
}
