// The frame-side half of the tooltip protocol (tips.tsx documents the attributes). See
// docs/ui-design.md § Tooltips for why this is a separate, importless module.

/**
 * Mounts the tooltip listener into a plugin frame's own document. See docs/ui-design.md
 * § Tooltips for why a frame needs its own copy.
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
    const rawAt = element.getAttribute('data-tip-at')
    const at = rawAt === null ? NaN : Number(rawAt)
    // This frame copy stays importless. Match kit/lib/rendering/formatRelativeTime for timestamp tips.
    const relative = () => {
      const elapsed = Math.max(0, Date.now() - at)
      const minute = 60_000
      const hour = 60 * minute
      const day = 24 * hour
      if (elapsed < minute) return 'now'
      if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`
      if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`
      if (elapsed < 30 * day) return `${Math.floor(elapsed / day)}d ago`
      return `${Math.floor(elapsed / (30 * day))}mo ago`
    }
    const sub = Number.isFinite(at) ? relative() : element.getAttribute('data-tip-sub')
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
    // A help mark's explanation draws at body weight in a wider bubble (tips.css).
    if (element.getAttribute('data-tip-kind') === 'help') bubble.dataset.kind = 'help'
    else delete bubble.dataset.kind
    // Inside a frame the viewport is the frame, so there is no rail to fly around: right, unless the
    // bubble would run past the frame's right edge. The same fit as the host's tips.tsx.
    const rect = element.getBoundingClientRect()
    bubble.style.left = `${rect.right + 8}px`
    bubble.style.right = ''
    bubble.style.top = `${rect.top + rect.height / 2}px`
    bubble.hidden = false
    const view = doc.defaultView
    if (!view) return
    const margin = 8
    const { offsetWidth: width, offsetHeight: height } = bubble
    if (rect.right + 8 + width > view.innerWidth - margin && rect.left - 8 - width >= margin) {
      bubble.style.left = ''
      bubble.style.right = `${view.innerWidth - rect.left + 8}px`
    }
    const middle = Math.max(margin + height / 2, Math.min(rect.top + rect.height / 2, view.innerHeight - margin - height / 2))
    bubble.style.top = `${middle}px`
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
