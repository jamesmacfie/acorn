import { mountFrameTips } from '../../../kit/lib/controls/frameTips'
import type { AcornBridge } from './bridgeTypes'
import { connect } from './connection'

/**
 * Everything between a frame's bundle evaluating and its own UI being on screen, which is the same
 * sequence in every frame: inject the plugin's stylesheet, make the root element, mount the frame-side
 * tooltip listener, connect, render, and draw the failure if the handshake never lands.
 *
 * Framework-free, which is why it takes a callback instead of a component: the sandbox allows any
 * framework or none, so the last step is the only step a plugin owns. A Solid frame, whole:
 *
 * ```tsx
 * mountFrame({ styles }, (bridge, root) => render(() => <MyApp bridge={bridge} />, root))
 * ```
 *
 * `styles` is the plugin's own stylesheet, imported with `?inline`. It's injected rather than linked
 * because a plugin origin serves exactly one file, `/client.js` plus the host's `/ui.css`, so a frame
 * with a separate asset is a broken frame.
 *
 * The failure path sets the Alert primitive's classes on the root by hand: there's no framework yet,
 * since that's what failed, and a blank rectangle tells the reader nothing.
 */
export function mountFrame(
  options: { styles: string },
  render: (bridge: AcornBridge, root: HTMLElement) => void,
): void {
  const style = document.createElement('style')
  style.textContent = options.styles
  document.head.append(style)

  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)

  // Every frame wants it and every frame forgot it: a frame has its own document, so the shell's
  // delegated tooltip singleton can't see it and each `data-tip` in here is otherwise inert.
  mountFrameTips(document)

  void connect()
    .then((bridge) => render(bridge, root))
    .catch((error: unknown) => {
      root.className = 'ui-alert'
      root.dataset.variant = 'banner'
      root.dataset.tone = 'danger'
      root.textContent = error instanceof Error ? error.message : String(error)
    })
}

/**
 * Delegated click handler for anchors inside a frame's own rendered content, such as a ticket
 * description, a comment or an error body. Returns whether the click was taken.
 *
 * Here rather than left to each frame because the plumbing is identical everywhere and the wrong version
 * of it is silent: an anchor in a frame can't navigate anything, since the iframe sandbox has no
 * `allow-popups` and the shell pins every subframe to its own origin, so a frame that forgets this
 * handler renders links that do nothing.
 *
 * On @acorn/plugin-api/ui/sdk beside `connect` rather than on the /ui barrel beside `renderMarkdown`,
 * even though the two are used on the same line. `renderMarkdown` qualifies there because it's pure,
 * text in and markup out, while this needs the bridge, and /ui is a barrel of Solid components a
 * non-Solid frame must be able to skip entirely.
 *
 * Modified clicks are taken too, unlike the shell's equivalent
 * (client-core/host/registries/panes/contentLinks.ts). In the shell a cmd-click is the reader asking for a browser
 * tab, so the anchor's default is preserved. In a frame there's no default to preserve, because the
 * sandbox swallows it, so treating a cmd-click as a plain click is the difference between working and
 * dead.
 *
 * A non-https href is left alone. `mailto:` is the honest casualty: `renderMarkdown` allows it, the
 * bridge verb doesn't, and a frame can't open a mail client any more than it can open a tab.
 */
export function openLinkOnClick(bridge: AcornBridge, event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false
  const href = (event.target as HTMLElement | null)?.closest?.('a')?.getAttribute('href')
  // The same scheme test the host will apply. Checked here too, so a link the host would refuse keeps
  // its inert default rather than becoming a denied bridge call and a console error per click.
  if (!href?.trim().toLowerCase().startsWith('https://')) return false
  event.preventDefault()
  void bridge.ui.openUrl(href).catch((error: unknown) => {
    console.error(`[acorn] could not open ${href}:`, error)
  })
  return true
}
