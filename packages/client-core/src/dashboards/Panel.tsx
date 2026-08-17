import { createSignal, For, Show, type JSX } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import type { PluginCollectionRow, PluginCollectionRowAction } from '@acorn/protocol/collections.ts'
import { activeNodeId } from '../node/activeNode'
import { FRESHNESS_LABELS } from '../node/freshness'
import { runChromeAction } from '../plugins/chrome/actions'
import { Alert, Button, Card, EmptyState } from '../ui/primitives'
import Icon from '../ui/Icon'
import { createPanelData } from './data'
import type { PanelDefinition } from './model'
import PanelBody from './views/PanelBody'
import './dashboards.css'

// ONE panel, wherever it is placed (docs/dashboards.md § Placements). Placement-agnostic on
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
  /** Spread onto the header. The HEADER is the placement's drag surface and the body is not: the
   *  body scrolls, selects and clicks, and a drag starting on a row would fight the row's own
   *  action. It also keeps a press inside a board body free for a future card gesture
   *  (docs/future/dashboards/write-back.md) — the two must never be ambiguous.
   *
   *  Opaque here on purpose. The panel does not know whether its surface offers dragging. */
  headProps?: JSX.HTMLAttributes<HTMLDivElement>
}

/** What the host says before dispatching a risky row action. The plugin declares a TIER, never a
 *  sentence — a plugin that could write the prompt could write a reassuring one over a destructive
 *  call. `read` is not risky and never reaches here. */
const RISK_PROMPT: Record<string, string> = {
  write: 'change something',
  execute: 'run something',
}

export default function Panel(props: PanelProps) {
  const data = createPanelData(() => props.definition)
  const nodeId = activeNodeId() ?? ''
  const navigate = useNavigate()
  const [pending, setPending] = createSignal<PluginCollectionRow | undefined>()

  const dispatch = (row: PluginCollectionRow): void => {
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

  const riskOf = (action: PluginCollectionRowAction | undefined): string | undefined =>
    action?.risk && action.risk !== 'read' ? action.risk : undefined

  // The row's own declared verb, through the host's dispatcher — the same closed set a rail row's
  // click runs, and the same refusals. A view never acts on its own, and there is no second path.
  //
  // THE CONFIRMATION IS THE HOST'S, drawn from the declared tier and drawn HERE rather than in a
  // view, so no view and no plugin can route around it. An action with no tier behaves exactly as it
  // always did — which is every action any plugin ships today.
  const activate = (row: PluginCollectionRow): void => {
    if (!row.action) return
    if (riskOf(row.action)) {
      setPending(row)
      return
    }
    dispatch(row)
  }

  const confirmPending = () => {
    const row = pending()
    setPending(undefined)
    if (row) dispatch(row)
  }

  /** The sources whose collection this device can actually resolve. A panel is inert only when NONE
   *  of them are — one plugin going away must not take a mixed panel's other half with it. */
  const resolved = () => data.sources().filter((source) => source.contribution())

  const viewProps = () => ({
    view: props.definition.view,
    panelId: props.definition.id,
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
      <div class="dash-panel-head" {...props.headProps}>
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
          {/* The armed step for a risky row action. A strip rather than a modal because the row it
              is about is still on screen behind it, and an explicit Continue rather than a second
              click on the row because "press it again" is the wrong shape for something that
              destroys. Nothing is dispatched until this button is pressed. */}
          <Show when={pending()}>
            {(row) => (
              <Alert tone="warn" actions={(
                <>
                  <Button size="xs" variant="bare" onClick={() => setPending(undefined)}>Cancel</Button>
                  <Button size="xs" variant="solid" tone="danger" onClick={confirmPending}>Continue</Button>
                </>
              )}
              >
                This asks {row().pluginId} to {RISK_PROMPT[riskOf(row().action) ?? ''] ?? 'act'}.
              </Alert>
            )}
          </Show>
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
            {/* The view switch is `views/PanelBody.tsx`, shared with the wizard's live preview —
                there is exactly one way to draw a panel and a preview that redrew it would be a
                second one. */}
            <PanelBody {...viewProps()} />
          </Show>
        </Show>
      </div>
    </Card>
  )
}
