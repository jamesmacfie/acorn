import { rendererLayer, type OverlayPresentation } from './index'
import { visibleElementRect, type VisibleElementRect } from './webviewGeometry'
import { isolateModal, modalInteractionRoot, releaseModalIsolation } from './overlayIsolation'
import { overlaps, pageClip } from './overlayGeometry'
import { createLogger } from '../telemetry/public'

// Presentation begins here, after Node/broker/cache data has reached its owning UI. Pages supply
// only a live DOM owner and geometry. Disposing that owner invalidates every scheduled update.
type Page = { element: HTMLElement; update: (bounds: VisibleElementRect, covered: boolean) => void }
const pages = new Set<Page>()
const ids = new WeakMap<Element, number>()
const clips = new Map<HTMLElement, { clip: string; display: string; height: string }>()
let nextId = 0
let generation = 0
let frame = 0
let stop: (() => void) | undefined
let nativeFailed = false
let last = ''
const log = createLogger('native-overlays')

// Inventory of host-owned floating roots. iframe documents are deliberately never traversed.
const SURFACES: Array<[string, OverlayPresentation['surfaces'][number]['role']]> = [
  ['.overlay-backdrop', 'modal'], ['.ui-popover', 'popover'], ['.repo-picker-popover-fixed', 'menu'],
  ['.rail-tip', 'tooltip'], ['.ui-toast', 'toast'], ['.ui-drawer', 'drawer'],
  ['.integrations-panel-backdrop', 'modal'], ['.integrations-panel', 'drawer'],
  ['.mention-popup', 'menu'], ['.settings-view', 'custom'], ['[data-host-overlay]', 'custom'],
]

function surfaces(): Array<{ element: HTMLElement; record: OverlayPresentation['surfaces'][number] }> {
  // A single query preserves DOM order for stacked modal owners and deduplicates matching roots.
  return [...document.querySelectorAll<HTMLElement>(SURFACES.map(([selector]) => selector).join(','))].flatMap((element) => {
    const role = SURFACES.find(([selector]) => element.matches(selector))![1]
    const style = getComputedStyle(element)
    const bounds = visibleElementRect(element)
    if (!bounds.width || !bounds.height || style.visibility === 'hidden' || style.display === 'none') return []
    let id = ids.get(element)
    if (!id) { id = ++nextId; ids.set(element, id) }
    return [{ element, record: { id, role, bounds, radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map((v) => parseFloat(v) || 0), interactive: style.pointerEvents !== 'none', modal: role === 'modal' } }]
  })
}

function ownsPage(element: HTMLElement, page: HTMLElement): boolean {
  return element.contains(page) || modalInteractionRoot(element).contains(page)
}

function restoreClips() {
  for (const element of clips.keys()) restoreBranch(element)
  clips.clear()
  document.body.classList.remove('native-page-composition')
}

function restoreBranch(element: HTMLElement) {
  const previous = clips.get(element)
  if (!previous) return
  element.style.clipPath = previous.clip
  element.style.display = previous.display
  element.style.height = previous.height
  clips.delete(element)
}

function compose(live: Array<{ page: Page; bounds: VisibleElementRect }>) {
  const branches = new Map<HTMLElement, VisibleElementRect[]>()
  for (const { page, bounds } of live) {
    let branch = page.element
    while (branch.parentElement && branch.parentElement !== document.body) branch = branch.parentElement
    if (branch.parentElement !== document.body) continue
    const holes = branches.get(branch) ?? []
    holes.push(bounds)
    branches.set(branch, holes)
  }
  for (const element of clips.keys()) if (!branches.has(element)) restoreBranch(element)
  for (const [branch, holes] of branches) {
    if (!clips.has(branch)) clips.set(branch, { clip: branch.style.clipPath, display: branch.style.display, height: branch.style.height })
    // display:contents has no paint box and cannot be clipped. Solid's Portal wrapper needs a
    // viewport-sized box while hosting a native page; its fixed descendants keep their positions.
    if (getComputedStyle(branch).display === 'contents') {
      branch.style.display = 'block'
      branch.style.height = `${window.innerHeight}px`
    }
    const rect = branch.getBoundingClientRect()
    // Solid Portal wrappers use display: contents. Their child owns the actual viewport box.
    const bounds = { x: rect.x, y: rect.y, width: rect.width || window.innerWidth, height: rect.height || window.innerHeight }
    const clip = pageClip(bounds, holes)
    if (branch.style.clipPath !== clip) branch.style.clipPath = clip
  }
  document.body.classList.toggle('native-page-composition', live.length > 0)
}

function reconcile() {
  frame = 0
  const layer = nativeFailed ? null : rendererLayer()
  const floating = surfaces()
  isolateModal(floating.filter(({ record }) => record.modal).map(({ element }) => element))
  const live = [...pages].filter((page) => page.element.isConnected).map((page) => ({ page, bounds: visibleElementRect(page.element) }))
  const owners = [...live.map(({ page }) => page.element), ...floating.map(({ element }) => element)]
  if (document.getAnimations?.().some((animation) => {
    const target = (animation.effect as KeyframeEffect | null)?.target
    return animation.playState === 'running' && target instanceof Element && owners.some((owner) => target.contains(owner))
  })) schedule()
  if (layer) compose(live)
  else restoreClips()
  for (const { page, bounds } of live) {
    const covered = !bounds.width || !bounds.height || (!layer && floating.some(({ element, record }) => !ownsPage(element, page.element) && overlaps(bounds, record.bounds)))
    page.update(bounds, covered)
  }
  if (!layer) return
  const presentation = { viewport: { width: window.innerWidth, height: window.innerHeight }, pages: live.map(({ page, bounds }) => ({ bounds, blockers: floating.filter(({ element, record }) => record.interactive && !ownsPage(element, page.element)).map(({ record }) => record.id) })), surfaces: floating.map(({ record }) => record) }
  const key = JSON.stringify(presentation)
  if (key === last) return
  last = key
  const version = ++generation
  void layer.update({ ...presentation, generation: version }).then((ready) => {
    if (ready || version !== generation || !pages.size) return
    nativeFailed = true
    void layer.update({ generation: ++generation, pages: [], surfaces: [] }).catch(() => {})
    // Geometry-only diagnostics: never page URLs, form values or plugin content.
    log.warn('composition unavailable backend=appkit stage=update; using page suppression')
    schedule()
  }).catch(() => {
    if (version !== generation || !pages.size) return
    nativeFailed = true
    void layer.update({ generation: ++generation, pages: [], surfaces: [] }).catch(() => {})
    log.warn('composition failed backend=appkit stage=update; using page suppression')
    schedule()
  })
}
const schedule = () => { if (!frame) frame = requestAnimationFrame(reconcile) }

function listen() {
  const resize = new ResizeObserver(schedule)
  resize.observe(document.documentElement)
  const mutation = new MutationObserver(schedule)
  mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'open', 'data-theme', 'data-style'] })
  mutation.observe(document.documentElement, { attributes: true })
  const outside = (event: Event) => {
    const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail
    // This is dismissal notification only. AppKit delivers the original press to the page once.
    const target = document.elementFromPoint(x, y) ?? document
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }))
  }
  const events = ['resize', 'scroll', 'load', 'transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel'] as const
  for (const event of events) window.addEventListener(event, schedule, true)
  document.fonts?.addEventListener('loadingdone', schedule)
  document.addEventListener('acorn:page-press', outside)
  return () => {
    resize.disconnect(); mutation.disconnect()
    for (const event of events) window.removeEventListener(event, schedule, true)
    document.fonts?.removeEventListener('loadingdone', schedule)
    document.removeEventListener('acorn:page-press', outside)
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    restoreClips()
    releaseModalIsolation()
    last = ''
    void rendererLayer()?.update({ generation: ++generation, pages: [], surfaces: [] })
  }
}

/** Shared page geometry and centralized overlap fallback. Caller owns native ensure/show lifetime. */
export function observeNativePage(element: HTMLElement, update: Page['update']): () => void {
  const page = { element, update }
  pages.add(page)
  if (!stop) stop = listen()
  const resize = new ResizeObserver(schedule)
  resize.observe(element)
  reconcile()
  return () => {
    pages.delete(page)
    resize.disconnect()
    if (!pages.size) { stop?.(); stop = undefined }
    else schedule()
  }
}
