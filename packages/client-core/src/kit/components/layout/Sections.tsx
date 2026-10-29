import { createSignal, For, Show, untrack, type JSX } from 'solid-js'
import { DetailColumn, ListColumn, ListDetail } from './ListDetail'
import { SectionHeader } from './SectionHeader'
import { TabPanel, Tabs } from './Tabs'

// One surface as a header, a set of named sections, and the one thing that gets the room: the shape
// a pull request has, and a ticket, and a build.
//
// Both hosts draw the sections as a strip of tabs over one panel, the header first. Stacked folds made
// a reader scroll past the description to reach the checks, and the other detail views (an issue, an
// error, a container) already switch with tabs. The node stays because the hosts still differ on
// `main`: a window gives it a column beside the tabs, and a narrow terminal makes it the last tab.
//
// Every part of a section is a thunk rather than an element, and both halves of that matter. The
// list has to be safe to ask for from outside a render: the terminal reads it in a key handler to
// answer `l`, and a cell renderable built there throws "No renderer found". And `render` runs once
// per section, so a caller that rebuilds its list does not rebuild what is on screen.

/** One named part of a surface. `render` is called only by a host that is drawing it. */
export type KitSection = {
  id: string
  label: string
  count?: number
  /** The verbs that belong to this section rather than to the surface: a refresh on a diff, a copy on
   *  a description. Drawn at the end of the strip while the section is open. */
  actions?: () => JSX.Element
  render: () => JSX.Element
}

// Remembering the tab you left open is the part a caller gets wrong, the same reason `Fold` keeps its
// own state (./Fold.tsx).
const readTab = (key: string): string => {
  try {
    return localStorage.getItem(`sections-tab:${key}`) ?? ''
  } catch {
    return ''
  }
}

const writeTab = (key: string, id: string): void => {
  try {
    localStorage.setItem(`sections-tab:${key}`, id)
  } catch {
    // A private-mode or quota failure must not take the strip with it.
  }
}

/* Sections: a header, its sections, and the main region. See docs/ui-design/closed-kit.md § The closed kit.

   At 80×24: the same strip of tabs over one panel, with `main` as the last tab where the terminal is
   too narrow to give it a column of its own. */
export function Sections(props: {
  /** Distinguishes this surface's stored tab and column state from another's. */
  id: string
  /** Names the column of sections. It is a landmark; name it. */
  ariaLabel?: string
  /** What the surface is about: the first tab. */
  header?: KitSection
  sections: readonly KitSection[]
  /** The region the surface exists to show: a diff, a log, a preview. */
  main?: KitSection
}) {
  const tabs = (): KitSection[] => [...(props.header ? [props.header] : []), ...props.sections]
  const [chosen, setChosen] = createSignal(readTab(props.id))
  // Falls back rather than storing a default, so a surface whose section set changes under it lands
  // on its first tab instead of on nothing. The terminal's strip keeps the same rule.
  const active = () => (tabs().some((tab) => tab.id === chosen()) ? chosen() : (tabs()[0]?.id ?? ''))
  const idPrefix = () => `sections-${props.id}`
  const activeActions = () => tabs().find((tab) => tab.id === active())?.actions
  const choose = (id: string) => {
    setChosen(id)
    writeTab(props.id, id)
  }

  return (
    <ListDetail
      split
      listWidth="wide"
      listLabel={props.ariaLabel}
      collapseKey={props.main ? `sections:${props.id}` : undefined}
      collapseContent="empty"
    >
      <ListColumn label={props.ariaLabel}>
        <Tabs
          tabs={tabs().map((tab) => ({
            id: tab.id,
            label: tab.label,
            ...(tab.count === undefined ? {} : { count: tab.count }),
          }))}
          active={active()}
          onChange={choose}
          idPrefix={idPrefix()}
          ariaLabel={props.ariaLabel ?? 'Sections'}
          actions={<Show when={activeActions()}>{(actions) => actions()()}</Show>}
        />
        {/* Keyed by id, not by object. A caller may rebuild its list whenever a count moves, as the
            change request's does. Keyed by object, every panel is torn down and rebuilt each time,
            and the panel loses its scroll position. Hidden panels stay mounted for the same reason. */}
        <For each={tabs().map((tab) => tab.id)}>
          {(id) => (
            <TabPanel idPrefix={idPrefix()} id={id} active={active()} padding="pane">
              {/* Built once per panel: a rebuilt list hands over a new `render`, not new content. */}
              {untrack(() =>
                tabs()
                  .find((candidate) => candidate.id === id)!
                  .render(),
              )}
            </TabPanel>
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
