/** @jsxImportSource @opentui/solid */
import { createEffect, For, Show } from 'solid-js'
import { Dynamic } from '@opentui/solid'
import { createQuery } from '@tanstack/solid-query'
import { integrationsOptions } from '@acorn/client-core/infra/queries.ts'
import { activeTaskId, selectedSource, setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { availableSources } from '@acorn/client-core/features/tabs/railSources.ts'
import { createSourceScope } from '@acorn/client-core/features/tabs/sourceScope.ts'
import { markersFor } from '@acorn/client-core/host/registries/rail/railMarkerFeed.ts'
import { resolveRailMarkers } from '@acorn/client-core/features/tabs/railMarkers.ts'
import { requestTaskAnnotations } from '@acorn/client-core/host/annotations/taskAnnotations.ts'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources/sources.ts'
import { Icon, Row, Rows, StatusDot } from '../kit/showing'
import { Line } from '../kit/cells'
import { Panel, PanelBody } from '../panel'
import { regionFocus } from '../keys/regions'
import { ExclusiveSlot } from './slot'
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

/** Which rail panel the screen opens on.
 *
 *  A task opened deliberately starts in Tasks. With no explicit view, Menu owns the initial focus so
 *  its selected first source and the caret agree about where the session began. Read by the shell,
 *  which hands it to the keys module as part of the topology (./Shell.tsx, ../keys/regions.ts). */
export const menuOpens = (): boolean => !!selectedSource() || !activeTaskId()

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
  const integrations = createQuery(() => integrationsOptions(true))
  const scope = createSourceScope(() => props.model.workspace()?.id)
  // Do not draw a partial Menu while its two gates are loading. Docker needs no provider, so it was
  // briefly the only row, took the caret, and remained the collection's remembered active row after
  // GitHub arrived above it. The shell then selected GitHub while visibly focusing Docker. Waiting
  // here makes the first drawn row the same first row the defaulting effect below selects.
  const sourcesReady = () => {
    const scoped = scope()
    return !!integrations.data && scoped.providers !== undefined && scoped.linked !== undefined
  }
  const sources = () => sourcesReady()
    ? availableSources(integrations.data?.integrations, scope())
    : []
  const source = () => sourceRegistry.get(selectedSource() ?? '')

  // Start each workspace on the first source the Menu actually draws. Provider and workspace-link
  // gates both load asynchronously, so wait for both before choosing: picking Docker from the partial
  // list and then replacing it with GitHub would make the answer depend on which query won a race.
  // An explicit task path or source selection wins for that workspace. `chooseWorkspace` clears both,
  // so the new workspace receives the same default instead of the first one-shot being spent forever.
  let defaultedWorkspace: string | null = null
  createEffect(() => {
    const workspace = props.model.workspace()
    if (!workspace || defaultedWorkspace === workspace.id) return
    if (activeTaskId() || selectedSource()) {
      defaultedWorkspace = workspace.id
      return
    }
    const scoped = scope()
    if (!integrations.data) return
    if (scoped.providers === undefined || scoped.linked === undefined) return
    const first = sources()[0]
    if (!first) return
    defaultedWorkspace = workspace.id
    setSelectedSource(first.id)
  })

  return (
    <box flexDirection="column" width={props.cells} flexShrink={0}>
      <Panel
        title="Menu"
        rows={MENU_ROWS}
        onBox={regionFocus(
          { paneId: 'chrome', regionId: 'menu' },
          MENU_ORDER,
          { column: 'rail', enterMainOnActivate: true, pickOnEnter: true },
        )}
      >
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
      <Panel title="Browse" grow>
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
                { paneId: 'chrome', regionId: 'browse' },
                BROWSE_ORDER,
                { column: 'rail', enterMainOnActivate: true, pickOnEnter: true },
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
          { paneId: 'chrome', regionId: 'tasks' },
          TASKS_ORDER,
          { column: 'rail', enterMainOnActivate: true },
        )}
      >
        <ExclusiveSlot slot="rail.taskList" core={() => <TaskList model={props.model} />} />
      </Panel>
    </box>
  )
}
