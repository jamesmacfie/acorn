import { Portal } from 'solid-js/web'
import type { JSX } from 'solid-js'

// The app's one drawer: a bottom dock between the two icon rails, above the task footer
// (docs/ui-design.md § Chrome and overlays).
//
// It exists because a drawer is a `drawer` slot rather than a pane, so no host layout owns its outer
// box — and until phase 9 of the layout programme that box was the terminal plugin's own stylesheet.
// Where the rails are, how tall the top bar is and which z-layer a drawer sits on are the shell's
// facts, not a plugin's, and a plugin that writes them down is one shell change away from being wrong.
//
// Not a modal. Nothing behind it goes inert, there is no backdrop and Escape does not dismiss it: the
// drawer is a second place to work, not an interruption. What is inside it is the caller's, and the
// terminal's is entirely kit nodes (docs/terminal-and-agents.md § Client).
export function Drawer(props: {
  /** Height in pixels while not maximized. The caller owns it because the caller owns the grip that
   *  drags it (`createSplitDrag`); ignored when `maximized`, where a top and a bottom decide it. */
  height: number
  maximized?: boolean
  ariaLabel: string
  /** The host box, for a caller that has to measure it or bind a drag to it. */
  ref?: (element: HTMLElement) => void
  children: JSX.Element
}) {
  return (
    <Portal>
      <aside
        ref={props.ref}
        class="ui-drawer"
        aria-label={props.ariaLabel}
        {...(props.maximized ? { 'data-maximized': '' } : {})}
        style={{ height: props.maximized ? undefined : `${props.height}px` }}
      >
        {props.children}
      </aside>
    </Portal>
  )
}
