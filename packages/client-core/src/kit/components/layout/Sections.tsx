import { For, Show, type JSX } from 'solid-js'
import { DetailColumn, ListColumn, ListDetail, SectionHeader } from '../primitives'
import { Fold } from './Fold'

// One surface as a header, a set of named sections, and the one thing that gets the room: the shape
// a pull request has, and a ticket, and a build.
//
// The node exists because that shape draws two completely different ways and the difference is the
// host's business rather than the caller's. A window has room for the sections down one side of the
// thing they are about, so they are folds beside a column — which is what github's PR surfaces drew
// by hand, a `ListDetail split` with a stack of `Fold`s in the list column, written out twice
// (docs/ui-design.md § The closed kit). A terminal has no second column to spend on six folds nobody
// can see the bottom of, so the same declaration is a strip of tabs and one panel.
//
// Every part of a section is a thunk rather than an element, and both halves of that matter. A
// section a host has decided not to draw must not be built — on this host that saves nothing, because
// every fold is mounted whether it is open or not, and on the terminal it is the difference between
// opening one tree and opening six. And the list itself has to be safe to ask for from outside a
// render: the terminal reads it in a key handler to answer `l`, and a cell renderable built there
// throws "No renderer found".

/** One named part of a surface. `render` is called only by a host that is drawing it. */
export type KitSection = {
  id: string
  label: string
  count?: number
  /** A fact about the section rather than a control on it: the rolled-up state of its checks, a
   *  count that is not a count. Beside the label where a host has room for it. */
  meta?: () => JSX.Element
  /** The verbs that belong to this section rather than to the surface: a refresh on a diff, a copy on
   *  a description. Drawn in whatever header the host gives the section. */
  actions?: () => JSX.Element
  render: () => JSX.Element
}

/* Sections: a header, its sections, and the main region. See docs/ui-design.md § The closed kit.

   At 80×24: a strip of tabs over one panel — the header first, then each section, then `main` where
   the terminal is too narrow to give it a column of its own. */
export function Sections(props: {
  /** Distinguishes this surface's stored fold state from another's. Persisted per section. */
  id: string
  /** Names the column of sections. It is a landmark; name it. */
  ariaLabel?: string
  /** What the surface is about, above the sections and always drawn. The terminal's first tab. */
  header?: KitSection
  sections: readonly KitSection[]
  /** The region the surface exists to show: a diff, a log, a preview. */
  main?: KitSection
}) {
  return (
    <ListDetail split listWidth="wide">
      {/* No header on the column: the surface opens with its own heading, which names the column
          better than a label would. The same call github's PR surfaces made before this node. */}
      <ListColumn scroll label={props.ariaLabel}>
        <Show when={props.header}>{(header) => header().render()}</Show>
        <For each={props.sections}>
          {(section) => (
            <Fold
              persistKey={`${props.id}.${section.id}`}
              defaultOpen
              label={section.label}
              {...(section.count === undefined ? {} : { count: section.count })}
              {...(section.meta ? { meta: section.meta() } : {})}
              {...(section.actions ? { actions: section.actions() } : {})}
            >
              {section.render()}
            </Fold>
          )}
        </For>
      </ListColumn>
      <Show when={props.main}>
        {(main) => (
          <DetailColumn>
            <SectionHeader {...(main().actions ? { actions: main().actions!() } : {})}>{main().label}</SectionHeader>
            {main().render()}
          </DetailColumn>
        )}
      </Show>
    </ListDetail>
  )
}
