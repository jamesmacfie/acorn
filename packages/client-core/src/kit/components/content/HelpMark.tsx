import { createUniqueId } from 'solid-js'
import Icon from './Icon'

/* The "?" a titled node draws after its title when given `help`. Internal to the kit: a node takes
   `help`, and nothing places this directly (docs/ui-design.md § Tooltips).

   A real button, so it is a tab stop and the tip opens on focus. Its name is "About" plus the title,
   so a page of marks reads "About Stop idle agents after" rather than "Help, help, help". Its
   description is the help text, so a screen reader gets the words without the bubble. A press
   focuses it, because WebKit does not focus a button on click and a touch screen has no hover.

   `textId` lets a host point its control's description at the same words. */
export function HelpMark(props: { text: string; titleId: string; textId?: string }) {
  const aboutId = createUniqueId()
  const ownTextId = createUniqueId()
  const textId = () => props.textId ?? ownTextId
  return (
    <>
      <button
        type="button"
        class="ui-help"
        aria-labelledby={`${aboutId} ${props.titleId}`}
        aria-describedby={textId()}
        data-tip={props.text}
        data-tip-kind="help"
        onClick={(event) => event.currentTarget.focus()}
      >
        <Icon name="circle-question-mark" />
      </button>
      <span id={aboutId} hidden>About</span>
      <span id={textId()} hidden>{props.text}</span>
    </>
  )
}
