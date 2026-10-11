import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { CORE_LINK_PREVIEW_POINT } from '@acorn/protocol/extensionPoints.ts'
import { createAnchoredPopover } from '../../kit/lib/controls/anchor'
import { copyText } from '../../kit/lib/controls/clipboard'
import { ContextMenu, Menu } from '../../kit/components/overlays/Menu'
import { Text } from '../../kit/components/content/Text'
import { Stack } from '../../kit/components/layout/Stack'
import { Button } from '../../kit/components/primitives'
import { toast } from '../../features/notifications/toast'
import { pluginLabel } from '../plugins/pluginLabel'
import { openInAppUrl } from '../registries/panes/contentLinks'
import { Slot } from '../tree/Slot'
import {
  closeLinkPreview,
  closeLinkPreviewOnNodeChange,
  holdLinkPreview,
  leaveLink,
  linkMenu,
  linkPreview,
  linkPreviewProps,
  openLinkPreview,
  setLinkMenu,
  type LinkPreviewRequest,
} from './linkPreview'
import './link-preview.css'

// The desktop's link preview and link menu, mounted once beside the other app-wide hosts. The state is
// ./linkPreview.ts; this file is the popover around a `core:link-preview` slot.

/** Open is the same host action as a click: an in-app destination when one claims the URL, else the
 *  browser. A preview never navigates on its own. */
export function openPreviewedLink(request: LinkPreviewRequest): void {
  if (openInAppUrl(request.url, { taskId: request.scope.taskId ?? null })) return
  window.open(request.url, '_blank', 'noopener,noreferrer')
}

export function LinkPreviewHost() {
  closeLinkPreviewOnNodeChange()
  let surface: HTMLElement | undefined
  const popover = createAnchoredPopover({
    anchor: () => linkPreview()?.anchor,
    placement: () => 'bottom-start',
    open: () => !!linkPreview(),
    onOpenChange: (open) => {
      if (!open) closeLinkPreview()
    },
  })
  // Measured again for every link, because pointer transfer keeps the surface open.
  createEffect(
    on(
      () => linkPreview()?.anchor,
      (anchor) => {
        if (anchor) popover.show()
      },
    ),
  )

  // A link that leaves the page takes its preview with it. Watched only while one is open.
  createEffect(() => {
    const anchor = linkPreview()?.anchor
    if (!anchor) return
    const observer = new MutationObserver(() => {
      if (!anchor.isConnected) closeLinkPreview()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    onCleanup(() => observer.disconnect())
  })

  // A preview opened from the menu holds focus while it is up and hands it back when it closes. One
  // opened by hovering never takes it.
  createEffect(
    on(
      linkPreview,
      (request, previous) => {
        if (request?.focus && request !== previous) queueMicrotask(() => surface?.focus())
        if (!previous?.focus || request?.focus) return
        const focused = document.activeElement
        if (!focused || focused === document.body || surface?.contains(focused)) previous.returnFocus?.focus()
      },
      { defer: true },
    ),
  )

  // The tree is bound to the task or project it was opened in, so a new scope is a new mount. A new URL
  // in the same scope is a props update, and the contributor's worker stays.
  const scopeKey = createMemo(() => {
    const request = linkPreview()
    return request ? `${request.scope.taskId ?? ''}\0${request.scope.projectId ?? ''}` : null
  })
  const [by, setBy] = createSignal<string>()

  return (
    <>
      <Show when={scopeKey()} keyed>
        {(_scope) => {
          // The last request, so nothing below reads a closed preview while the surface is torn down.
          let last = linkPreview()!
          const request = () => (last = linkPreview() ?? last)
          return (
            <Portal>
              <div
                ref={(element) => {
                  surface = element
                  popover.setSurface(element)
                }}
                class="ui-popover link-preview"
                role="dialog"
                aria-label={`Preview of ${request().label ?? request().url}`}
                tabindex="-1"
                style={popover.surfaceStyle()}
                onPointerEnter={holdLinkPreview}
                onPointerLeave={leaveLink}
              >
                <Slot
                  point={CORE_LINK_PREVIEW_POINT}
                  key={request().url}
                  props={() => linkPreviewProps(request())}
                  {...(request().scope.taskId ? { taskId: request().scope.taskId } : {})}
                  projectId={request().scope.projectId ?? null}
                  occupied={(occupied, pluginId) => setBy(occupied ? pluginId : undefined)}
                >
                  <Stack gap="inline">
                    <Show when={request().label}>
                      {(label) => (
                        <Text emphasis="strong" wrap>
                          {label()}
                        </Text>
                      )}
                    </Show>
                    <Text tone="muted" wrap>
                      {request().url}
                    </Text>
                  </Stack>
                </Slot>
                <div class="link-preview-footer">
                  <Show when={by()}>{(pluginId) => <Text tone="muted">From {pluginLabel(pluginId())}</Text>}</Show>
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      const opened = request()
                      closeLinkPreview()
                      openPreviewedLink(opened)
                    }}
                  >
                    Open
                  </Button>
                </div>
              </div>
            </Portal>
          )
        }}
      </Show>
      <ContextMenu
        at={() => linkMenu()?.at ?? null}
        ariaLabel="Link actions"
        onClose={() => setLinkMenu(null)}
        returnFocus={() => linkMenu()?.request.returnFocus}
      >
        {(menu) => (
          // Keyed, because an item closes the menu before its own `onSelect` runs.
          <Show when={linkMenu()?.request} keyed>
            {(request) => (
              <>
                <Menu.Item context={menu} onSelect={() => openLinkPreview(request)}>
                  Preview
                </Menu.Item>
                <Menu.Item context={menu} onSelect={() => openPreviewedLink(request)}>
                  Open link
                </Menu.Item>
                <Menu.Item
                  context={menu}
                  onSelect={() => {
                    const url = request.url
                    void copyText(url).then((copied) => {
                      if (!copied) toast(`Could not copy ${url}`, { tone: 'danger' })
                    })
                  }}
                >
                  Copy link
                </Menu.Item>
              </>
            )}
          </Show>
        )}
      </ContextMenu>
    </>
  )
}
