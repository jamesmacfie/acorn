import { children, Show, type JSX } from 'solid-js'
import { SectionHeader } from './SectionHeader'

export type SectionProps = {
  label: string
  count?: number
  /** What the section is for, behind a "?" after the label. */
  help?: string
  actions?: JSX.Element
  sticky?: boolean
  children: JSX.Element
}

/* Section: a labelled group of things. The sidebar section label agents, changes, notes and docker
   browse each wrote by hand.

   A section that opens and closes is a Fold, not a Section with a flag. Two names, because the
   header of one is a focus stop and the header of the other is not.

   At 80×24: the label in dim uppercase, the children below. */
export function Section(props: SectionProps) {
  // Read once, for the reason on RowParts (./Row.tsx): testing the children and then inserting them built the
  // whole section body twice.
  const body = children(() => props.children)
  return (
    <section class="ui-section" aria-label={props.label}>
      <SectionHeader level="group" sticky={props.sticky} count={props.count} help={props.help} actions={props.actions}>
        {props.label}
      </SectionHeader>
      <Show when={body()}>{body()}</Show>
    </section>
  )
}
