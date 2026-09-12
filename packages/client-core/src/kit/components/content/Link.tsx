import { Show, type JSX } from 'solid-js'
import { isExternal } from '../primitives'

/* Link: a run of words inside a sentence that acts.

   `Text` is presentational and stays that way, `Button` is a control with button geometry that sits
   wrong on a text baseline, and `Chip` is a boxed token rather than words. So a pane with a
   clickable ref inside a title had nothing to reach for and wrote a raw `<a>` with a private class
   (docs/ui-design.md § The closed kit). This is the word for it.

   Two shapes, and the prop that is set decides which. With `href` it is a real anchor, so
   middle-click, "open in new tab" and "copy link address" all work; `onPress` beside it takes the
   plain left click, the way `Row` does. With no `href` there is no URL to navigate to — a bare ref
   token such as `CRA-404` names an issue, not an address — so it is a `<button>`, which is what
   gives it the keyboard for free.

   At 80×24: the text, underlined, pressable. */
export function Link(props: {
  /** A real URL. Leave it out for a token that opens something inside the app. */
  href?: string
  onPress?: () => void
  children: JSX.Element
}) {
  return (
    <Show
      when={props.href}
      fallback={
        <button type="button" class="ui-link" onClick={() => props.onPress?.()}>
          {props.children}
        </button>
      }
    >
      {(href) => (
        <a
          class="ui-link"
          href={href()}
          target={isExternal(href()) ? '_blank' : undefined}
          rel={isExternal(href()) ? 'noopener noreferrer' : undefined}
          onClick={(event) => {
            if (!props.onPress) return
            // Leave the browser its own answers: a new tab, a new window, a handler that already
            // claimed the event.
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            props.onPress()
          }}
        >
          {props.children}
        </a>
      )}
    </Show>
  )
}
