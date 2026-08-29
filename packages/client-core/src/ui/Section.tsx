import { Show, type JSX } from 'solid-js'
import { SectionHeader } from './primitives'

/* Section: a labelled group of things. The sidebar section label agents, changes, notes and docker
   browse each wrote by hand.

   A section that opens and closes is a Fold, not a Section with a flag. Two names, because the
   header of one is a focus stop and the header of the other is not.

   At 80×24: the label in dim uppercase, the children below. */
export function Section(props: {
  label: string
  count?: number
  actions?: JSX.Element
  sticky?: boolean
  children: JSX.Element
}) {
  return (
    <section class="ui-section" aria-label={props.label}>
      <SectionHeader level="group" sticky={props.sticky} count={props.count} actions={props.actions}>
        {props.label}
      </SectionHeader>
      <Show when={props.children}>{props.children}</Show>
    </section>
  )
}
