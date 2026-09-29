import { createEffect, Show, type JSX } from 'solid-js'
import type { Size, Tone } from '../../tokens/tokens'

/** Whether the reader is mid-sentence somewhere. A text field with the caret in it is the one thing
 *  nothing may take focus from on its own account. */
const isTyping = (doc: Document): boolean => {
  const active = doc.activeElement
  return active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
    || (active instanceof HTMLElement && active.isContentEditable)
}

/* Card: a bordered grouping surface. No mandated Header/Body/Footer slots; acorn's cards are small
   and dense, and slots would get in the way.

   Distinct from Row. A style pack may render list rows as cards, so the two share surface tokens
   but keep separate semantics: grouping against list item. */
export function Card(props: {
  interactive?: boolean
  selected?: boolean
  stripe?: Extract<Tone, 'accent' | 'ok' | 'warn' | 'danger'>
  pad?: Extract<Size, 'sm' | 'md'>
  /** Sized by what is inside it rather than by the room it is given, for several cards standing in a
   *  row. A surface is full width by default because most of them are the only thing on their line;
   *  a button is the wrong stand-in for the ones that are not, since a control's padding is zero at
   *  the top and bottom by design and anything taller than one line touches both edges. */
  fit?: boolean
  disabled?: boolean
  onPress?: () => void
  title?: string
  /** Put the reader on this card: scroll it into view and give it focus.
   *
   *  The kit's, not the caller's, for the reason collection state is: a pane that has been told
   *  "show this item" holds a key and nothing else, and the kit gives it no class and no id to
   *  select on. Setting this is how a pane says which card it means. */
  focus?: boolean
  children: JSX.Element
}) {
  let element: HTMLElement | undefined
  const attrs = () => ({
    class: 'ui-card',
    'data-selected': props.selected ? '' : undefined,
    'data-stripe': props.stripe,
    'data-pad': props.pad ?? 'md',
    'data-fit': props.fit ? '' : undefined,
    title: props.title,
  })
  // A rising edge, not a standing order. `focus` is a prop getter, and a pane derives it from a row it
  // rebuilds on every streamed event, so this effect is re-notified while the value stays true. Re-running
  // the reveal then would yank the reader back to this card and take the caret out of whatever they were
  // typing. Reveal once when it turns true; act again only after it has gone false and true again.
  let revealed = false
  createEffect(() => {
    if (!props.focus || !element) { revealed = false; return }
    if (revealed) return
    revealed = true
    // And never out of a box someone is typing in. The rising edge above only holds while this card
    // stays mounted: a list that refetches rebuilds its rows, and the rebuilt row that happens to be
    // the selected one re-issues a reveal nobody asked for. The reader who finds out is the one whose
    // sentence lost the caret, so a reveal that would interrupt typing is dropped rather than queued.
    if (isTyping(element.ownerDocument)) return
    element.scrollIntoView({ block: 'nearest' })
    element.focus({ preventScroll: true })
  })
  return (
    <Show
      when={props.interactive || props.onPress}
      fallback={(
        // `tabindex` only on the plain card: an interactive one is already a stop, and taking it out
        // of the tab order to make it focusable by script would be the opposite of the ask.
        <div ref={(el) => { element = el }} {...attrs()} tabindex={props.focus === undefined ? undefined : -1}>
          {props.children}
        </div>
      )}
    >
      <button
        ref={(el) => { element = el }}
        type="button"
        {...attrs()}
        data-interactive=""
        disabled={props.disabled}
        onClick={() => props.onPress?.()}
      >
        {props.children}
      </button>
    </Show>
  )
}
