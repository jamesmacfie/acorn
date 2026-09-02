/** @jsxImportSource @opentui/solid */
import { createEffect, For, Show } from 'solid-js'
import { Dynamic } from '@opentui/solid'
import { activeTaskId, selectedSource, setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { markersFor } from '@acorn/client-core/host/registries/rail/railMarkerFeed.ts'
import { resolveRailMarkers } from '@acorn/client-core/features/tabs/railMarkers.ts'
import { requestTaskAnnotations } from '@acorn/client-core/host/annotations/taskAnnotations.ts'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources/sources.ts'
import { Icon, Row, Rows, StatusDot } from '../kit/showing'
import { Line } from '../kit/cells'
import { Panel, PanelBody } from '../panel'
import { regionFocus } from '../keys/regions'
import { ExclusiveSlot } from './slot'
import { BROWSE, MENU, TASKS } from './topology'
import type { ShellModel } from './model'

// The left column: three framed panels, read down the screen.
//
//   Menu    the browse sources this workspace has — GitHub, Linear, Docker
//   Browse  what is under the chosen one, which is that source's own `list` region
//   Tasks   the tasks in this workspace
//
// The shape is lazygit's and the arrangement is this host's alone, the same way `./Shell.tsx` is: the
// desktop draws one rail with the tasks in it and the sources under a rule, because it has a URL and
// a pointer and a browse surface fills the window. Here a browse surface is the main panel and its
// list is a panel of its own, so the reader can see the source, the item and its detail at once —
// which at 80 columns is the only way to see all three.
//
// Menu and Browse together are what the desktop's rail plus its browse surface's own list column are.
// The list arrives through `SourceContribution.regions`, because a source that hands over one opaque
// component cannot have its list drawn anywhere but where the component puts it
// (client-core/host/registries/sources/sources.ts § regions).
//
// The marks on a task row are the same ones the desktop draws around a rail control (`core:task`,
// features/tabs/railMarkers.ts). A corner is a pixel idea, so in cells the placement is dropped and
// the glyphs sit in the row's trailing slot in the order the allocator put them — same data, same
// order, one dimension fewer.

/** Cells across, from the shell's own width: about a third of it, between a floor and a ceiling.
 *
 *  A fixed number could not be right at both ends. Thirty cells reads well at 120 and leaves 48 for
 *  the pane at 80, where the agents session list starts clipping its own titles; twenty-four fits
 *  there and wastes a wide terminal. The same shape `list-detail` uses to pick its list width, with
 *  the fraction and the floor in the same place (../layouts/ListDetail.tsx). */
const FRACTION = 0.3
const MIN_CELLS = 20
const MAX_CELLS = 34
export const railCells = (shellCells: number): number =>
  Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.round(shellCells * FRACTION)))

/** Rows each fixed panel keeps, borders included. Browse takes what is left, because it is the panel
 *  holding a list nobody can page through if it is four rows tall. */
const MENU_ROWS = 7
const TASKS_ROWS = 7

/** The leftmost column. Every region in this file is in it and every region anywhere else defaults
 *  to the one to its right, which is what makes Right from a rail panel enter the pane and Left from
 *  the pane come back (../keys/regions.ts § moveColumn). */
const RAIL = 0

/** Before every region a layout registers, so the cycle reads down the screen (./Shell.tsx). */
const MENU_ORDER = -130
const BROWSE_ORDER = -120
const TASKS_ORDER = -110

function Marks(props: { markers: ReturnType<typeof markersFor> }) {
  const placed = () => resolveRailMarkers(props.markers).placed
  return (
    <box flexDirection="row">
      <For each={placed()}>
        {(marker) => (
          <Show when={marker.icon} fallback={<StatusDot tone={marker.dotTone === 'bad' ? 'danger' : marker.dotTone === 'ok' ? 'ok' : marker.dotTone === 'warn' ? 'warn' : 'muted'} />}>
            {(icon) => <Icon name={icon()} tone={marker.tone === 'neutral' ? undefined : marker.tone} />}
          </Show>
        )}
      </For>
    </box>
  )
}

function TaskList(props: { model: ShellModel }) {
  // What other plugins have to say about the rows on screen: one request for the whole list, re-asked
  // when the list changes. Nothing here reads the answers — they come back as markers.
  createEffect(() => requestTaskAnnotations(props.model.tasks().map((task) => task.id)))

  return (
    <Rows
      virtual
      id="chrome.rail.tasks"
      ariaLabel="Tasks"
      items={props.model.tasks().map((task) => ({ key: task.id, task }))}
      onActivate={(id) => {
        const task = props.model.tasks().find((row) => row.id === id)
        if (task) activateTaskSignals(task)
      }}
    >
      {/* No leading icon. A task's glyph is a Lucide name and this host draws a name it has no
          character for as nothing, so the column was a ragged left edge: two blanks and one mark
          (../kit/glyphs.ts). The marks on the right carry the state that mattered. */}
      {(row, item) => (
        <Row
          item={item}
          selected={!selectedSource() && row.task.id === activeTaskId()}
          trailing={<Marks markers={markersFor({ kind: 'task', id: row.task.id })} />}
        >
          {row.task.title}
        </Row>
      )}
    </Rows>
  )
}

export function Rail(props: { model: ShellModel; cells: number }) {
  // Three panels and nothing else: which sources this workspace has, and which of them the session
  // starts on, are both the model's (./model.ts § defaultSource). A component that draws is a
  // component that cannot race the thing it draws.
  const sources = () => props.model.sources()
  const source = () => sourceRegistry.get(selectedSource() ?? '')

  return (
    <box flexDirection="column" width={props.cells} flexShrink={0}>
      <Panel
        title="Menu"
        rows={MENU_ROWS}
        onBox={regionFocus(
          MENU,
          MENU_ORDER,
          { x: RAIL, enterMainOnActivate: true, pickOnEnter: true },
        )}
      >
        {/* Empty while the provider and workspace-link gates are still loading, which is a rendering
            decision and not a focus one: a partial Menu draws a row that is about to move
            (./model.ts § sourcesReady). */}
        <Show when={sources().length} fallback={<Line role="muted">No sources here.</Line>}>
          <Rows
            virtual
            // Collection state is a place within one roster. A workspace switch replaces that
            // roster, so a workspace being visited for the first time starts on its first row
            // instead of inheriting the previous workspace's active source.
            id={`chrome.rail.sources.${props.model.workspace()?.id ?? 'loading'}`}
            ariaLabel="Sources"
            items={sources().map((entry) => ({ key: entry.id, ...entry }))}
            selected={selectedSource()}
            onSelect={setSelectedSource}
            onActivate={setSelectedSource}
          >
            {(entry, item) => (
              <Row item={item} selected={selectedSource() === entry.id}>{entry.label}</Row>
            )}
          </Rows>
        </Show>
      </Panel>
      {/* The chosen source's own list, drawn here rather than in the surface it belongs to. A source
          that has not declared regions keeps its whole surface in the main panel and this panel says
          so, which is the honest answer and not an error. */}
      {/* `scroll`, because a source's list is as long as the source says and the rail is one column
          of a fixed screen: without a viewport the rows past the fold were drawn nowhere and the
          caret walked off the bottom of the panel (../kit/scrolling.tsx,
          docs/tui.md § Scrolling viewports). */}
      <Panel title="Browse" grow scroll>
        <Show
          when={source()?.regions?.list}
          fallback={
            <PanelBody>
              <Line role="muted">{source() ? 'Nothing to list here.' : 'Choose a source.'}</Line>
            </PanelBody>
          }
        >
          {(list) => (
            // Keep the frame in the layout for component-only sources, but only register a region
            // around a list a reader can actually drive. The Show owns cleanup when that list goes.
            <box
              flexDirection="column"
              flexGrow={1}
              ref={regionFocus(
                BROWSE,
                BROWSE_ORDER,
                { x: RAIL, enterMainOnActivate: true, pickOnEnter: true },
              )}
            >
              {/* A source's list region is a `lazy()` and it can throw, and `PanelBody` is what this
                  panel draws for each of those rather than the blank frame both used to leave
                  (../panel.tsx). */}
              <PanelBody><Dynamic component={list()} /></PanelBody>
            </box>
          )}
        </Show>
      </Panel>
      {/* An explicitly opened task starts here, through the shell's topology; the ordinary startup
          path begins in Menu above, on its first available source. */}
      <Panel
        title="Tasks"
        rows={TASKS_ROWS}
        onBox={regionFocus(
          TASKS,
          TASKS_ORDER,
          { x: RAIL, enterMainOnActivate: true },
        )}
      >
        <ExclusiveSlot slot="rail.taskList" core={() => <TaskList model={props.model} />} />
      </Panel>
    </box>
  )
}
