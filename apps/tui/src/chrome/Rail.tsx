/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import { Dynamic } from '../tree/renderer'
import { activeTaskId, selectedSource, setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { markersFor } from '@acorn/client-core/host/registries/rail'
import { resolveRailMarkers } from '@acorn/client-core/features/tabs'
import { requestTaskAnnotations } from '@acorn/client-core/host/annotations/taskAnnotations.ts'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources'
import { keyedRows, Row, Rows } from '../kit/showing'
import { Line } from '../kit/cells'
import { Panel, PanelBody } from '../panel'
import { Modal, ModalBody } from '../kit/grouping'
import { regionFocus } from '../keys/regions'
import { ExclusiveSlot } from './slot'
import { registerCoreExclusiveSlot } from '@acorn/client-core/host/registries/extensionPoints'
import { BROWSE, MENU, TASKS } from './topology'
import type { ShellModel } from './model'
import { setHighlightedTaskId } from './state'
import { workflowTaskHierarchy } from '@acorn/client-core/features/tasks'
import { expandedWorkflowRoots, toggleWorkflowRoot } from '@acorn/client-core/features/tasks'

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

function Marks(props: { markers: ReturnType<typeof markersFor>; cells: number }) {
  const legend = () => resolveRailMarkers(props.markers).legend
  const label = () => {
    const count = legend().length
    if (!count) return ''
    return props.cells >= 7 ? `${count} marks` : `+${count}`
  }
  return <Show when={label()}>{(text) => <Line role="muted">{text()}</Line>}</Show>
}

function TaskList(props: { model: ShellModel; markerCells: number }) {
  // What other plugins have to say about the rows on screen: one request for the whole list, re-asked
  // when the list changes. Nothing here reads the answers — they come back as markers.
  createEffect(() => requestTaskAnnotations(props.model.tasks().map((task) => task.id)))
  const [inspecting, setInspecting] = createSignal<string | null>(null)
  const inspectedMarkers = createMemo(() => {
    const taskId = inspecting()
    return taskId ? resolveRailMarkers(markersFor({ kind: 'task', id: taskId })).legend : []
  })
  const inspectedRows = createMemo(() => inspectedMarkers().map((marker, index) => ({
    key: String(index),
    label: marker.l,
  })))

  // Kept rather than rebuilt, so a `tasks:changed` costs the rows that changed rather than all of
  // them (../kit/showing.tsx § keyedRows).
  const hierarchy = createMemo(() => workflowTaskHierarchy(props.model.tasks(), expandedWorkflowRoots(), activeTaskId()))
  const depthByTask = createMemo(() => new Map(
    hierarchy().map((entry) => [entry.task.id, entry.depth]),
  ))
  // Cache against the original task row, not the hierarchy wrapper. `taskHierarchy` returns fresh
  // wrappers when the roster changes, while TanStack preserves every unchanged task object. The
  // getter keeps depth correct when a parent appears or disappears without rebuilding the child row.
  const rows = keyedRows(
    () => hierarchy().map((entry) => entry.task),
    (task) => ({
      key: task.id,
      task,
      get depth() { return depthByTask().get(task.id) ?? 0 },
      get group() { return hierarchy().find(entry => entry.task.id === task.id) },
    }),
  )

  return (
    <>
    <Rows
      virtual
      id="chrome.rail.tasks"
      ariaLabel="Tasks"
      items={rows()}
      onSelect={setHighlightedTaskId}
      onMenu={(id) => {
        if (resolveRailMarkers(markersFor({ kind: 'task', id })).legend.length) setInspecting(id)
      }}
      onActivate={(id) => {
        const task = props.model.tasks().find((row) => row.id === id)
        const group = hierarchy().find(entry => entry.task.id === id)
        if (task && id === activeTaskId() && group?.workflowDescendants) toggleWorkflowRoot(id)
        else if (task) activateTaskSignals(task)
      }}
    >
      {/* The task title carries the identity. The count at the right exposes annotations; the
          marker modal contains their labels. Neither needs a replacement for a Lucide icon. */}
      {(row, item) => (
        <Row
          item={item}
          selected={!selectedSource() && row.task.id === activeTaskId()}
          keepTrailing
          trailing={<Marks markers={markersFor({ kind: 'task', id: row.task.id })} cells={props.markerCells} />}
        >
          {row.depth
            ? `${'  '.repeat(row.depth - 1)}↳ ${row.task.title}`
            : row.group?.workflowDescendants
              ? `${row.group.expanded ? '▾' : '▸'} ${row.task.title} · ${row.group.workflowDescendants}`
              : row.task.title}
        </Row>
      )}
    </Rows>
    <Show when={inspecting()}>
      <Modal onDismiss={() => setInspecting(null)} title="Task markers" size="sm">
        <ModalBody>
          <box height={3} flexShrink={0}>
            <Rows virtual id="chrome.rail.task-markers" ariaLabel="Task markers" items={inspectedRows()}>
              {(marker, item) => <Row item={item}>{marker.label}</Row>}
            </Rows>
          </box>
        </ModalBody>
      </Modal>
    </Show>
    </>
  )
}

type TaskListSlotValue = {
  model: ShellModel
  markerCells: number
}

// The terminal can mount more than one shell during tests or a renderer handoff. Core is one
// provider in the shared registry; the current shell model and available marker width travel as
// host-owned slot data.
registerCoreExclusiveSlot('rail.taskList', (props) => {
  const value = props.value as TaskListSlotValue
  return <TaskList model={value.model} markerCells={value.markerCells} />
})

export function Rail(props: { model: ShellModel; cells: number; nodeId: string }) {
  // Three panels and nothing else: which sources this workspace has, and which of them the session
  // starts on, are both the model's (./model.ts § defaultSource). A component that draws is a
  // component that cannot race the thing it draws.
  const sources = () => props.model.sources()
  const sourceRows = keyedRows(sources, (entry) => ({ key: entry.id, ...entry }))
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
            items={sourceRows()}
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
            <PanelBody name="browse" nodeId={props.nodeId}>
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
              <PanelBody name="browse" nodeId={props.nodeId}><Dynamic component={list()} /></PanelBody>
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
        <ExclusiveSlot
          slot="rail.taskList"
          value={{ model: props.model, markerCells: Math.max(2, props.cells - 22) } satisfies TaskListSlotValue}
        />
      </Panel>
    </box>
  )
}
