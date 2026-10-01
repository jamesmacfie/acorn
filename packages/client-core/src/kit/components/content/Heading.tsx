import { Dynamic } from 'solid-js/web'
import { createUniqueId, Show, type JSX } from 'solid-js'
import { HelpMark } from './HelpMark'

export type HeadingProps = {
  level?: 1 | 2 | 3
  eyebrow?: string
  /** What the page or pane is for, behind a "?" after the title. */
  help?: string
  children: JSX.Element
}

/* Heading: an eyebrow over a title. The pattern linear, rollbar, github and docker each drew with
   two divs and a pair of classes.

   `level` is the document level, not a size: the kit picks the type from the level so a pane cannot
   pick an h3 because it liked the smaller text.

   At 80×24: the eyebrow in dim uppercase, the heading in bold, the help in grey under it. */
export function Heading(props: HeadingProps) {
  const titleId = createUniqueId()
  const title = () => (
    <Dynamic
      component={`h${[1, 2, 3, 4, 5, 6].includes(props.level ?? 2) ? props.level ?? 2 : 2}`}
      class="ui-heading-title"
      id={props.help ? titleId : undefined}
    >
      {props.children}
    </Dynamic>
  )
  return (
    <div class="ui-heading" data-level={String(props.level ?? 2)}>
      <Show when={props.eyebrow}><span class="ui-heading-eyebrow">{props.eyebrow}</span></Show>
      <Show when={props.help} fallback={title()}>
        {(help) => (
          <span class="ui-titled">
            {title()}
            <HelpMark text={help()} titleId={titleId} />
          </span>
        )}
      </Show>
    </div>
  )
}
