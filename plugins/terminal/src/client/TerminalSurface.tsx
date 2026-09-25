import { createEffect, onCleanup, untrack } from 'solid-js'
import { Rectangle } from '@acorn/plugin-api/ui'
import { activeNodeId } from '@acorn/plugin-api/client'
import { liveXterm, type LiveXterm } from './liveXterm'

// One session's box in the drawer (docs/terminal.md § Client). The xterm inside is not this
// component's: it lives from the first frame the tab is shown until the tab closes (./liveXterm.ts,
// ./heldTerminals.ts), and this surface lends it an element while it is drawn. Inside the drawer the
// parent draws every session's surface and hides all but one, so switching tabs is a repaint; across
// tasks the drawer itself unmounts, and coming back moves the same attached xterm into the new box
// instead of building a fresh one and asking the node for its screen.
export default function TerminalSurface(props: { sessionId: string; fontSize: number; hidden?: boolean; onExit?: (exitCode: number | null) => void }) {
  let host!: HTMLElement
  let terminal: LiveXterm | undefined
  let gone = false

  createEffect(() => {
    const fontSize = props.fontSize
    terminal?.setFontSize(fontSize)
  })

  // Found or built on the first frame this box is shown, then re-fitted and re-focused every time it
  // comes back. `show()` on the next frame, because the `hidden` attribute is written by its own
  // effect and xterm cannot measure a box that is still display:none when this one runs.
  createEffect(() => {
    if (props.hidden) {
      terminal?.hide()
      return
    }
    // `props.hidden` is the only thing this effect follows. Finding the terminal reads the font size
    // and the session id on its way past, and tracking those would rebuild nothing but would re-run
    // `show()` — which focuses the terminal, so a font-size preference change would steal the caret.
    untrack(() => {
      terminal ??= liveXterm(activeNodeId() ?? '', props.sessionId, host, props.fontSize)
      terminal.mount(host, (exitCode) => props.onExit?.(exitCode))
      terminal.setFontSize(props.fontSize)
      requestAnimationFrame(() => { if (!gone && !props.hidden) terminal?.show() })
    })
  })

  onCleanup(() => {
    gone = true
    terminal?.unmount(host)
  })

  // A PTY is pixels, so it is a rectangle rather than a tree: the kit owns the box and the way in and
  // out of it with the keyboard, and xterm owns everything inside (docs/terminal-and-agents.md §
  // Client). `mount` is the element xterm attaches to, drawn by the host, which is why this file spells
  // no element and carries no stylesheet.
  return <Rectangle kind="pty" label="Terminal" hidden={props.hidden} mount={(element) => { host = element }} />
}
