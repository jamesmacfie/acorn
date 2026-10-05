import { safeContentHref } from '@acorn/protocol/externalUrl.ts'
import { createLogger } from '@acorn/client-core/infra/telemetry'

const log = createLogger('shell')

// The main renderer's external navigation belongs to the device. Run after the content's handlers,
// so a link claimed by an in-app pane never reaches the OS. The Rust command validates again.
export function installExternalLinks(host: Window, openUrl: (url: string) => Promise<void>): void {
  const externalHref = (raw: string): string | null => {
    const safe = safeContentHref(raw)
    if (!safe) return null
    const url = new URL(safe, host.location.href)
    return url.protocol === 'mailto:' || (['http:', 'https:'].includes(url.protocol) && url.origin !== host.location.origin)
      ? url.href : null
  }
  const open = (href: string) => {
    void openUrl(href).catch((error: unknown) => log.error('Could not open external URL', error))
  }
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || (event.type === 'click' ? event.button !== 0 : event.button !== 1)) return
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor || anchor.hasAttribute('download')) return
    const href = externalHref(anchor.href)
    if (!href) return
    event.preventDefault()
    open(href)
  }
  host.addEventListener('click', click)
  host.addEventListener('auxclick', click)

  // Host actions and sandboxed-plugin bridge requests use window.open for their browser fallback.
  // WebKit applies on_navigation before on_new_window, so the handoff must happen in the bridge.
  const nativeOpen = host.open.bind(host)
  host.open = (url, target, features) => {
    const href = url && externalHref(String(url))
    if (!href || ['_self', '_parent', '_top'].includes(target ?? '')) return nativeOpen(url, target, features)
    open(href)
    return null
  }
}
