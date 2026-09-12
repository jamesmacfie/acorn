import { Dynamic } from 'solid-js/web'
import { Show, type JSX } from 'solid-js'

/* Heading: an eyebrow over a title. The pattern linear, rollbar, github and docker each drew with
   two divs and a pair of classes.

   `level` is the document level, not a size: the kit picks the type from the level so a pane cannot
   pick an h3 because it liked the smaller text.

   At 80×24: the eyebrow in dim uppercase, the heading in bold. */
export function Heading(props: { level?: 1 | 2 | 3; eyebrow?: string; children: JSX.Element }) {
  return (
    <div class="ui-heading" data-level={String(props.level ?? 2)}>
      <Show when={props.eyebrow}><span class="ui-heading-eyebrow">{props.eyebrow}</span></Show>
      <Dynamic component={`h${props.level ?? 2}`} class="ui-heading-title">{props.children}</Dynamic>
    </div>
  )
}
