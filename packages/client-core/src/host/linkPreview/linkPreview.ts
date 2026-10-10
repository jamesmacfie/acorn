import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import { CORE_LINK_PREVIEW_POINT, linkPreviewKey, type LinkPreviewProps } from '@acorn/protocol/extensionPoints.ts'
import { activeNodeId } from '../../infra/node/activeNode'
import { extensionPointRegistry } from '../registries/extensionPoints/extensionPoints'
import { claimFor } from '../registries/panes/contentLinks'

// One preview of one link at a time, for the whole client (docs/plugins/link-previews.md § Link previews).
//
// This module holds which link is being previewed and the hover timing. It draws nothing. The desktop
// draws the preview in LinkPreviewHost.tsx and the terminal in a dialog. Content reaches it through a
// boundary that a content owner puts around its region, so Markdown, provider HTML and remote trees
// need no listener of their own on each link.

// Registered where the controller is, like `core:storage` is with its page: the point exists wherever a
// host can draw it, and both hosts import this module.
extensionPointRegistry.register({
  id: CORE_LINK_PREVIEW_POINT,
  ownerId: 'core',
  label: 'Link preview',
  kind: 'remote',
  mode: 'replace',
  max: 1,
})

/** The task or project of the content the link sits in. The owner's, never the shell's active task. */
export type LinkPreviewScope = { taskId?: string; projectId?: string }

export type LinkPreviewRequest = {
  /** The normalized URL, which is also the point's key. */
  url: string
  label?: string
  scope: LinkPreviewScope
  /** The link on screen, for the desktop to hang the preview off. The terminal has none. */
  anchor?: HTMLElement
  /** The boundary the link was found in, so that boundary can close what it opened. */
  boundary?: object
  /** Asked for by a menu rather than by hovering: the preview takes focus, and gives it back. */
  focus: boolean
  returnFocus?: HTMLElement
}

export const HOVER_DWELL_MS = 350
export const LEAVE_GRACE_MS = 150
const MAX_LABEL = 200

const [current, setCurrent] = createSignal<LinkPreviewRequest | null>(null)
let openedOn: string | null = null
let dwell: ReturnType<typeof setTimeout> | undefined
let grace: ReturnType<typeof setTimeout> | undefined

const clearTimers = (): void => {
  clearTimeout(dwell)
  clearTimeout(grace)
}

/** The preview on screen, or `null`. */
export const linkPreview = current

export function openLinkPreview(request: LinkPreviewRequest): void {
  clearTimers()
  openedOn = activeNodeId()
  setCurrent(request)
}

export function closeLinkPreview(): void {
  clearTimers()
  setCurrent(null)
}

/** The pointer reached a link. It opens after the dwell unless the pointer leaves first. */
export function hoverLink(request: Omit<LinkPreviewRequest, 'focus'>): void {
  clearTimeout(grace)
  const open = current()
  if (open && open.anchor === request.anchor) return
  clearTimeout(dwell)
  dwell = setTimeout(() => openLinkPreview({ ...request, focus: false }), HOVER_DWELL_MS)
}

/** The pointer left a link or the preview. A short grace lets it cross the gap between the two. */
export function leaveLink(): void {
  clearTimeout(dwell)
  clearTimeout(grace)
  if (current()) grace = setTimeout(closeLinkPreview, LEAVE_GRACE_MS)
}

/** The pointer entered the preview, so it stays. */
export const holdLinkPreview = (): void => clearTimeout(grace)

/** What the contributor is mounted with. `ref` is what an in-app recogniser made of the URL, never more. */
export function linkPreviewProps(request: LinkPreviewRequest): LinkPreviewProps {
  const claim = claimFor(request.url)
  const kind = claim?.target.kind
  const id = claim?.target.item
  return {
    url: request.url,
    ...(request.label ? { label: request.label } : {}),
    ...(request.scope.taskId ? { taskId: request.scope.taskId } : {}),
    ...(request.scope.projectId ? { projectId: request.scope.projectId } : {}),
    ...(typeof kind === 'string' && kind.length <= 64 && typeof id === 'string' && id && id.length <= 300
      ? { ref: { kind, id } } : {}),
  }
}

/** The link text as a label: trimmed, collapsed, capped, and left out when it is just the URL again. */
export function linkLabel(text: string, url: string): string | undefined {
  const label = text.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL)
  return label && label !== url ? label : undefined
}

/** The previewable link an event landed on, or `null`. A link with no HTTPS href, such as a bare
 *  `ENG-1` reference, has nothing to preview. */
export function previewableLink(target: EventTarget | null): { anchor: HTMLAnchorElement; url: string } | null {
  const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
  const url = anchor ? linkPreviewKey(anchor.getAttribute('href') ?? '') : null
  return anchor && url ? { anchor, url } : null
}

// Boundaries can nest: a task's panes sit inside the shell's project region. The innermost one sees an
// event first and claims it, so the owner nearest the link supplies the scope.
const claimed = new WeakSet<Event>()
const claim = (event: Event): boolean => {
  if (claimed.has(event)) return false
  claimed.add(event)
  return true
}

/** What a right-click or the menu key on a link opened, for the desktop's link menu. */
export type LinkMenuOpening = { at: { x: number; y: number }; request: LinkPreviewRequest }

const [linkMenu, setLinkMenu] = createSignal<LinkMenuOpening | null>(null)
export { linkMenu, setLinkMenu }

/**
 * Event handlers for a region of content whose links can be previewed. Spread them on the element that
 * already holds the content. One set per region, never one per link, and none of it reaches a worker.
 *
 * Call it inside the owner's component: the preview it opened closes when the owner unmounts or its
 * scope changes.
 */
export function createLinkPreviewBoundary(scope: () => LinkPreviewScope) {
  const boundary = {}
  const ours = (): boolean => current()?.boundary === boundary
  const requestFor = (anchor: HTMLAnchorElement, url: string): Omit<LinkPreviewRequest, 'focus'> => {
    const label = linkLabel(anchor.textContent ?? '', url)
    return { url, ...(label ? { label } : {}), scope: scope(), anchor, boundary }
  }
  const openMenu = (anchor: HTMLAnchorElement, url: string, at: { x: number; y: number }): void => {
    closeLinkPreview()
    setLinkMenu({ at, request: { ...requestFor(anchor, url), focus: true, returnFocus: anchor } })
  }

  // A memo, because `on` re-runs whenever its source is read again, even with the same ids.
  const scopeKey = createMemo(() => `${scope().taskId ?? ''}\0${scope().projectId ?? ''}`)
  createEffect(on(scopeKey, () => { if (ours()) closeLinkPreview() }, { defer: true }))
  onCleanup(() => { if (ours()) closeLinkPreview() })

  // Hover only. Focus alone opens nothing: tabbing through a reply would pop a preview at every link,
  // and focus returning to a link after its preview closed would open it again. The keyboard asks
  // through the link menu instead.
  return {
    onPointerOver: (event: PointerEvent) => {
      const link = event.pointerType === 'touch' ? null : previewableLink(event.target)
      if (link && claim(event)) hoverLink(requestFor(link.anchor, link.url))
    },
    onPointerOut: (event: PointerEvent) => {
      const link = previewableLink(event.target)
      // Moving between the words of one link is not leaving it.
      if (!link || (event.relatedTarget instanceof Node && link.anchor.contains(event.relatedTarget))) return
      leaveLink()
    },
    onContextMenu: (event: MouseEvent) => {
      const link = previewableLink(event.target)
      // A modified right-click is the person asking the platform for its own menu.
      if (!link || event.altKey || !claim(event)) return
      event.preventDefault()
      openMenu(link.anchor, link.url, { x: event.clientX, y: event.clientY })
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
      const link = previewableLink(event.target)
      if (!link || !claim(event)) return
      event.preventDefault()
      const rect = link.anchor.getBoundingClientRect()
      openMenu(link.anchor, link.url, { x: rect.left, y: rect.bottom })
    },
  }
}

/** A preview opened on one node closes when the window moves to another. Started once by each host. */
export function closeLinkPreviewOnNodeChange(): void {
  createEffect(() => {
    const node = activeNodeId()
    if (current() && node !== openedOn) closeLinkPreview()
  })
}
