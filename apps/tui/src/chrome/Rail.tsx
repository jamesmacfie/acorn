/** @jsxImportSource @opentui/solid */
import { createEffect, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { integrationsOptions } from '@acorn/client-core/infra/queries.ts'
import { activeTaskId, selectedSource, setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { availableSources } from '@acorn/client-core/features/tabs/railSources.ts'
import { createSourceScope } from '@acorn/client-core/features/tabs/sourceScope.ts'
import { taskOriginAppearance } from '@acorn/client-core/features/tasks/origin.ts'
import { markersFor } from '@acorn/client-core/host/registries/rail/railMarkerFeed.ts'
import { resolveRailMarkers } from '@acorn/client-core/features/tabs/railMarkers.ts'
import { requestTaskAnnotations } from '@acorn/client-core/host/annotations/taskAnnotations.ts'
import { Icon, Row, Rows, StatusDot } from '../kit/showing'
import { Rule } from '../kit/cells'
import { regionFocus } from '../keys/regions'
import { ExclusiveSlot } from './slot'
import type { ShellModel } from './model'

// The rail: the tasks in this workspace, and the browse sources under a rule.
//
// Drawn through `ExclusiveSlotHost`'s registry, exactly as the desktop's task list is, so the day a
// plugin offers to replace `rail.taskList` its offer replaces this too and nothing here changes
// (./slot.tsx, docs/future/client-plugins/04-replaceable-surfaces.md).
//
// The marks are the same ones the desktop draws around a rail control (`core:task`,
// features/tabs/railMarkers.ts). A corner is a pixel idea, so in cells the placement is dropped and
// the glyphs sit in the row's trailing slot in the order the allocator put them — same data, same
// order, one dimension fewer.

/** Below this many cells across the whole shell the rail is a marker strip. The desktop's
 *  `leftCollapsed` preference at a width instead of a click, because there is no grip to drag and no
 *  room to spare (docs/future/terminal/07-chrome.md § The screen). */
export const RAIL_COLLAPSE_AT = 100

/** Before every region a layout registers, so the cycle reads down the screen (./Shell.tsx). */
const RAIL_ORDER = -100

const EXPANDED_CELLS = 18
const COLLAPSED_CELLS = 2

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

function TaskList(props: { model: ShellModel; collapsed: boolean }) {
  // What other plugins have to say about the rows on screen: one request for the whole list, re-asked
  // when the list changes. Nothing here reads the answers — they come back as markers.
  createEffect(() => requestTaskAnnotations(props.model.tasks().map((task) => task.id)))

  return (
    <Rows
      id="chrome.rail.tasks"
      ariaLabel="Tasks"
      items={props.model.tasks().map((task) => ({ key: task.id, task }))}
      onActivate={(id) => {
        const task = props.model.tasks().find((row) => row.id === id)
        if (task) activateTaskSignals(task)
      }}
    >
      {(row, item) => (
        <Row
          item={item}
          selected={!selectedSource() && row.task.id === activeTaskId()}
          leading={<Icon name={row.task.icon ?? taskOriginAppearance(row.task.origin).glyph} />}
          trailing={<Marks markers={markersFor({ kind: 'task', id: row.task.id })} />}
        >
          {props.collapsed ? '' : row.task.title}
        </Row>
      )}
    </Rows>
  )
}

export function Rail(props: { model: ShellModel; collapsed: boolean }) {
  const integrations = createQuery(() => integrationsOptions(true))
  const scope = createSourceScope(() => props.model.workspace()?.id)
  const sources = () => availableSources(integrations.data?.integrations, scope())

  return (
    <box
      flexDirection="column"
      width={props.collapsed ? COLLAPSED_CELLS : EXPANDED_CELLS}
      flexShrink={0}
      ref={regionFocus({ paneId: 'chrome', regionId: 'rail' }, RAIL_ORDER)}
    >
      <ExclusiveSlot slot="rail.taskList" core={() => <TaskList model={props.model} collapsed={props.collapsed} />} />
      {/* Only where there is something under it. A rule with nothing below is a line that means
          nothing, and the bundled roster registers no browse source until the pane sweep. */}
      <Show when={sources().length}>
        <Rule />
        <Rows
          id="chrome.rail.sources"
          ariaLabel="Sources"
          items={sources().map((source) => ({ key: source.id, ...source }))}
          onActivate={setSelectedSource}
        >
          {(source, item) => (
            <Row item={item} selected={selectedSource() === source.id} leading={<Icon name={source.glyph} />}>
              {props.collapsed ? '' : source.label}
            </Row>
          )}
        </Rows>
      </Show>
    </box>
  )
}
