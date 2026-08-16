import { For, Match, Show, Switch, type JSX } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import type { PluginCollectionRow } from '@acorn/protocol/collections.ts'
import { activeNodeId } from '../node/activeNode'
import { FRESHNESS_LABELS } from '../node/freshness'
import { runChromeAction } from '../plugins/chrome/actions'
import { Alert, Button, Card, EmptyState } from '../ui/primitives'
import Icon from '../ui/Icon'
import { createPanelData } from './data'
import type { PanelDefinition } from './model'
import BoardView from './views/BoardView'
import ListView from './views/ListView'
import StatView from './views/StatView'
import TableView from './views/TableView'
import './dashboards.css'

// ONE panel, wherever it is placed (docs/future/dashboards/placements.md). Placement-agnostic on
// purpose: the surface owns the grid and the add/remove chrome, this owns a panel's own frame,
// freshness and body, so a task pane or a plugin-reserved region is a container away.
//
// The inert case is the interesting one. A panel whose collections are not registered — the plugin is
// disabled, uninstalled, or simply not on this node — renders as "source unavailable" and SURVIVES:
// its definition is untouched and it comes back when the plugin does. The registry lookup happens
// here, at render, precisely so persistence never had to make that judgement (tasks/layout.ts).
//
// On a panel over SEVERAL collections that becomes a partial state rather than a binary one, and
// every degradation below is per source: a missing plugin, a node that could not answer for one
// collection, and a stale answer beside a live one all name the source they are about and leave the
// rest rendering. Only a panel with nothing resolvable at all goes inert.

export type PanelProps = {
  definition: PanelDefinition
  /** Surface chrome — a remove button, a drag handle. The panel does not know what it is placed in. */
  actions?: JSX.Element
}

export default function Panel(props: PanelProps) {
  const data = createPanelData(() => props.definition)
  const nodeId = activeNodeId() ?? ''
  const navigate = useNavigate()

  // The row's own declared verb, through the host's dispatcher — the same closed set a rail row's
  // click runs, and the same refusals. A view never acts on its own, and there is no second path.
  const activate = (row: PluginCollectionRow): void => {
    if (!row.action) return
    // `pluginId` is the HOST's stamp on the row, never a field the plugin sent, so a collection
    // cannot route its clicks into a stranger's pane (plugins/chrome/data.ts § readCollection).
    //
    // `navigate` is what lets an `openUrl` row land on acorn's own surface for that item instead of in
    // the browser — the dispatcher asks the recogniser registry, and a URL with no in-app route still
    // opens externally. A panel row genuinely has no task and no routed project, which is why the row
    // declares `openUrl` in the first place; resolving the project from the URL is the missing step.
    //
    // `prefer: 'route'` is the dashboard saying what it IS. A panel row is a jumping-off point — you are
    // looking at a list precisely in order to leave it — so the full surface is the destination and a
    // glance panel over a list you were abandoning would be the wrong shape. Surfaces you are working
    // INSIDE ask for the opposite, and get it (plugins/github § makeContentLinkHandler).
    runChromeAction(row.action, { pluginId: row.pluginId, nodeId, navigate, prefer: 'route' })
  }

  /** The sources whose collection this device can actually resolve. A panel is inert only when NONE
   *  of them are — one plugin going away must not take a mixed panel's other half with it. */
  const resolved = () => data.sources().filter((source) => source.contribution())

  const viewProps = () => ({
    view: props.definition.view,
    schema: data.schema(),
    fields: data.fields(),
    rows: data.rows(),
    ...(props.definition.shaping.groupBy ? { groupBy: props.definition.shaping.groupBy } : {}),
    // Only where there is more than one source to tell apart.
    ...(data.sources().length > 1 ? { provenance: true } : {}),
    onActivate: activate,
  })

  return (
    <Card class="dash-panel" pad="sm">
      <div class="dash-panel-head">
        <span class="dash-panel-title">{props.definition.title}</span>
        <span class="dash-panel-meta">
          {/* Only when it is not live. A badge that always says "Live" is furniture. */}
          <Show when={data.freshness() && data.freshness() !== 'live'}>
            <span class="muted">{FRESHNESS_LABELS[data.freshness()!]}</span>
          </Show>
        </span>
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          title={data.refreshSeconds() ? `Refreshes every ${data.refreshSeconds()}s` : 'Refresh'}
          aria-label={`Refresh ${props.definition.title}`}
          onClick={() => data.refresh()}
        >
          <Icon name="refresh-cw" />
        </Button>
        {props.actions}
      </div>

      <div class="dash-panel-body">
        <Show
          when={resolved().length}
          fallback={(
            <EmptyState align="start" size="sm" title="Source unavailable">
              {props.definition.queries.length
                ? `${props.definition.queries.map((query) => `${query.pluginId} · ${query.collectionId}`).join(', ')} not provided here.`
                : 'This panel names no collection.'}
            </EmptyState>
          )}
        >
          {/* PARTIAL AVAILABILITY IS DATA. One source that could not be read is a banner naming that
              source; the others keep rendering. A mixed panel that blanked because linear was slow
              would be the fleet machinery's mistake made one tier down (node/fanout.ts). */}
          <For each={data.unavailable()}>
            {(entry) => <Alert tone="warn">{entry.label} unavailable — {entry.reason}</Alert>}
          </For>
          {/* A source whose plugin is not here at all, on a panel where another source is. Said once
              rather than per row: the rows are simply not in the union. */}
          <For each={data.sources().filter((source) => !source.contribution())}>
            {(source) => (
              <Alert tone="warn">
                {source.query.pluginId} is not providing “{source.query.collectionId}” here.
              </Alert>
            )}
          </For>
          <Show
            when={data.answered()}
            fallback={(
              <EmptyState align="start" size="sm" busy={!data.unavailable().length}>
                {data.unavailable().length ? 'No cached rows.' : 'Loading…'}
              </EmptyState>
            )}
          >
            <Switch
              // A view kind this build cannot draw — a definition written by a client that has more
              // of them. Same answer as an unresolved collection: say so, change nothing.
              fallback={(
                <EmptyState align="start" size="sm" title="View unavailable">
                  This panel uses a “{props.definition.view.kind}” view, which this version does not draw.
                </EmptyState>
              )}
            >
              <Match when={props.definition.view.kind === 'stat'}><StatView {...viewProps()} /></Match>
              <Match when={props.definition.view.kind === 'list'}><ListView {...viewProps()} /></Match>
              <Match when={props.definition.view.kind === 'table'}><TableView {...viewProps()} /></Match>
              <Match when={props.definition.view.kind === 'board'}><BoardView {...viewProps()} /></Match>
            </Switch>
          </Show>
        </Show>
      </div>
    </Card>
  )
}
