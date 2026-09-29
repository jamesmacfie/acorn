/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, For, Show, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import type { KitSection } from '@acorn/client-core/kit/components/layout'
import { flatten, Line, slot } from '../cells'
import { ScrollViewport } from '../scrolling'
import { TabPanel, Tabs } from './tabs'

/** Keep the section name visible when action labels need the full width of a terminal panel. */
export function SectionHeader(props: {
  level?: 'pane' | 'group' | 'sub'
  sticky?: boolean
  count?: number
  actions?: JSX.Element
  children: JSX.Element
}) {
  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <Line role="strong">{flatten(props.children)}</Line>
        <Show when={props.count !== undefined}><Line role="muted">{String(props.count)}</Line></Show>
      </box>
      <Show when={props.actions}>{slot(props.actions)}</Show>
    </box>
  )
}

// ── Sections ──────────────────────────────────────────────────────────────────────────────────

/** Cells below which `main` stops being a column of its own and becomes the last tab.
 *
 *  Higher than `ListDetail`'s 80, and for a reason the two columns do not share. A list beside a
 *  detail is a picker beside a document, and a picker reads fine in thirty cells. Here both halves
 *  hold a document — a pull request's checks beside its diff — and a diff in half of 100 cells is a
 *  diff wrapped at 45, which is not a diff anybody reads. */
const MAIN_COLUMN_AT = 120

/** reduced: a strip of tabs over one panel, because a terminal has no second column to spend on six
 *  folds nobody can see the bottom of.
 *
 *  The tab order is the reading order the DOM draws down its column: the header, then each section.
 *  `main` keeps a column of its own while there is room for one and joins the strip below that, which
 *  is the same collapse `ListDetail` makes at its own width.
 *
 *  The strip is a real parent stop: Left/Right selects, Down enters the selected panel, Escape from
 *  that panel comes back, and a second Escape crosses to the rail (../../keys/regions.ts). */
export function Sections(props: {
  id: string
  ariaLabel?: string
  header?: KitSection
  sections: readonly KitSection[]
  main?: KitSection
}) {
  let box: Renderable | undefined
  const [cells, setCells] = createSignal(MAIN_COLUMN_AT)
  const wide = () => cells() >= MAIN_COLUMN_AT && !!props.main
  const tabs = (): KitSection[] => [
    ...(props.header ? [props.header] : []),
    ...props.sections,
    ...(props.main && !wide() ? [props.main] : []),
  ]
  const [chosen, setChosen] = createSignal('')
  // Falls back rather than storing a default, so a surface whose section set changes under it lands
  // on its first tab instead of on nothing. The same rule the `tabs` layout keeps.
  const active = () => (tabs().some((tab) => tab.id === chosen()) ? chosen() : tabs()[0]?.id ?? '')
  return (
    <box
      flexDirection="row"
      flexGrow={1}
      ref={(element: Renderable) => {
        box = element
        setCells(element.width)
      }}
      onSizeChange={() => setCells(box?.width ?? MAIN_COLUMN_AT)}
    >
      <box
        flexDirection="column"
        flexGrow={1}
        minWidth={0}
      >
        <Tabs
          tabs={tabs().map((tab) => ({ id: tab.id, label: tab.label, ...(tab.count === undefined ? {} : { count: tab.count }) }))}
          active={active()}
          onChange={setChosen}
          idPrefix={props.id}
          ariaLabel={props.ariaLabel ?? 'Sections'}
          {...(() => { const found = tabs().find((tab) => tab.id === active())?.actions; return found ? { actions: found() } : {} })()}
        />
        <For each={tabs()}>
          {(tab) => (
            <TabPanel idPrefix={props.id} id={tab.id} active={active()}>
              {tab.render()}
            </TabPanel>
          )}
        </For>
      </box>
      {/* `minWidth={0}` on both halves, because a flex child's floor is its own content and a diff is
          routinely wider than its share (../layouts/ListDetail.tsx). */}
      <Show when={wide() && props.main}>
        {(main) => (
          <box flexDirection="column" flexGrow={1} minWidth={0}>
            <SectionHeader {...(main().actions ? { actions: main().actions!() } : {})}>{main().label}</SectionHeader>
            <ScrollViewport>{main().render()}</ScrollViewport>
          </box>
        )}
      </Show>
    </box>
  )
}
