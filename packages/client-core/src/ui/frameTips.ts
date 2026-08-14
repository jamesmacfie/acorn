// The frame-side half of the tooltip protocol (tips.tsx documents the attributes).
//
// Its own module, and framework-free on purpose: tips.tsx imports Solid, Icon, the primitives and a
// stylesheet for the shell's singleton, and this function is reached from
// @acorn/plugin-api/ui/sdk — which is bundled INTO a plugin's frame and must not drag a slice of the
// shell (or a second copy of Solid) across that boundary. Nothing here imports anything.

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
