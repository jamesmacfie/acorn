/** @jsxImportSource @opentui/solid */
import { createMemo, Show } from 'solid-js'
import { Dynamic } from '@opentui/solid'
import { useNavigate, useParams } from '@solidjs/router'
import type { PluginRailItem, PluginSourceDescriptor } from '@acorn/protocol/api.ts'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { createFleetQuery } from '@acorn/client-core/infra/node/fanout.ts'
import { chromeDeps, chromeKey, readRailItems, scopedSourceItemsPath } from '@acorn/client-core/host/chrome/chromeData.ts'
import { runChromeAction } from '@acorn/client-core/host/chrome/actions.ts'
import { decodeProjectSurfaceItem, projectSurfaceRegistry } from '@acorn/client-core/host/registries/panes/projectSurfaces.ts'
import type { SourcePanel } from '@acorn/client-core/host/chrome/sourcePanel.ts'
import { Alert, Badge, EmptyState, Row, Rows } from '../kit/showing'
import { Line } from '../kit/cells'

// A descriptor source's rail list, in cells.
//
// `client-core/host/chrome/ChromeSourcePanel.tsx` is the DOM's, and it cannot be this one: it is
// `<main class="panes">` around `<section>`s and the DOM kit's primitives, so registering it here
// handed the reconciler a `main` and it refused — which is what selecting Linear in `acorn` did before
// this file existed (../../../packages/client-core/src/host/chrome/sourcePanel.ts).
//
// The halves that are not drawing are shared and are imported rather than rewritten: `readRailItems`
// and `chromeKey` are the query, `runChromeAction` is what a row press does, and
// `projectSurfaceRegistry` is what the detail is. So the two hosts cannot disagree about the cache
// key, the verbs, or which surface a row addresses. What differs is where the halves go — the desktop
// draws both across one window, and this host puts the list in its Browse panel and the detail in the
// main one (docs/tui.md § The screen), which is why this exports a `regions` pair rather than a
// component.
//
// Three parts of the DOM panel are not here, and they are omissions rather than gaps in the seam:
// the title filter, the create-task menu on a row, and the dashboard panels beside the list. Each is
// a surface of its own on this host and none of them is what a rail list is for. The filter is the one
// worth adding first, because a list of a hundred issues is a list nobody can page through.

/** One row's secondary text: the aligned fields where a source sends them, the pre-joined line where
 *  it sends that instead. The DOM reserves a track per field so the Nth lines up down the list; in
 *  cells they are joined, because a column of aligned tracks in twenty-two cells is one fact wide. */
const secondary = (item: PluginRailItem): string =>
  (item.fields?.length ? item.fields.join(' · ') : item.subtitle ?? '')

function SourceList(props: { pluginId: string; descriptor: PluginSourceDescriptor }) {
  const params = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const nodeId = activeNodeId() ?? ''

  // The same fan-out the DOM panel runs, pinned to one node, with the project in the dependency rather
  // than read inside the fetch so it reaches the cache key too. Both hosts build the key with
  // `chromeKey`, so a list drawn here and the same list drawn there are one cache entry.
  const scope = () => ({
    revision: chromeDeps(props.pluginId),
    projectId: props.descriptor.projectScoped ? params.projectId : undefined,
  })
  const [result] = createFleetQuery(
    ({ projectId }) => chromeKey(props.pluginId, props.descriptor.id, projectId),
    (node, { projectId }, signal) => readRailItems(
      props.pluginId,
      scopedSourceItemsPath(props.descriptor.items, projectId),
      node,
      signal,
    ),
    scope,
    { nodeIds: [nodeId] },
  )

  const row = () => result().rows[0]
  const items = createMemo<PluginRailItem[]>(() => row()?.data ?? [])
  const unavailable = () => result().unavailable[0]

  const select = (id: string): void => {
    const item = items().find((entry) => entry.id === id)
    if (!item || !props.descriptor.onSelect) return
    runChromeAction(props.descriptor.onSelect, {
      pluginId: props.pluginId,
      nodeId,
      item,
      // No promote on this host: the create-task modal is a surface of its own and this panel does not
      // draw one. A verb that asks for it is a no-op rather than a crash.
      promote: () => {},
      ...(params.projectId ? { projectId: params.projectId } : {}),
      navigate,
    })
  }

  return (
    <>
      {/* A node that did not answer and had nothing cached is a banner, never a failed pane — the same
          call the DOM panel makes, because "nothing is assigned to you" is a claim the host cannot make
          on a failed fetch. */}
      <Show when={unavailable()}>
        {(entry) => <Alert tone="warn">{`${entry().label} unavailable: ${entry().reason}`}</Alert>}
      </Show>
      <Show
        when={row()}
        fallback={<Line role="muted">{unavailable() ? 'No cached items.' : 'Loading…'}</Line>}
      >
        <Show
          when={items().length}
          fallback={<EmptyState title={props.descriptor.label}>{props.descriptor.emptyState?.message ?? 'Nothing here yet.'}</EmptyState>}
        >
          <Rows
            virtual
            id={`chrome.source.${props.pluginId}.${props.descriptor.id}`}
            ariaLabel={props.descriptor.label}
            items={items().map((item) => ({ key: item.id, item }))}
            onSelect={select}
            onActivate={select}
          >
            {(entry, item) => (
              <Row
                item={item}
                // `stacked`, so the secondary line sits under the title rather than running into it.
                // The DOM reserves a track per field and lines the Nth up down the list; twenty-two
                // cells has room for one fact, so they are joined above and given their own line here.
                variant={secondary(entry.item) ? 'stacked' : 'default'}
                meta={<Show when={secondary(entry.item)}>{(text) => <Line role="muted">{text()}</Line>}</Show>}
                trailing={<Show when={entry.item.badge}>{(badge) => <Badge>{badge()}</Badge>}</Show>}
              >
                {entry.item.title}
              </Row>
            )}
          </Rows>
        </Show>
      </Show>
    </>
  )
}

/** The other half: the project-scoped surface a `navigate` row addresses, and nothing at all for a
 *  source whose rows do something else. The selection is the path, as it is on the desktop, so a row
 *  press and a remembered address are the same thing (client-core registries/panes/projectSurfaces.ts). */
function SourceDetail(props: { descriptor: PluginSourceDescriptor }) {
  const params = useParams<Record<string, string>>()
  const surface = () => {
    const onSelect = props.descriptor.onSelect
    return onSelect?.verb === 'navigate' ? projectSurfaceRegistry.get(onSelect.surface) : undefined
  }
  return (
    <Show when={surface()} fallback={<EmptyState title={props.descriptor.label}>Choose a row.</EmptyState>}>
      {(entry) => (
        <Show when={params.projectId} fallback={<Line role="muted">Choose a project with `p`.</Line>}>
          {(projectId) => (
            <Dynamic
              component={entry().component}
              projectId={projectId()}
              item={decodeProjectSurfaceItem(params[entry().item])}
            />
          )}
        </Show>
      )}
    </Show>
  )
}

/** What the chrome registry asks this host for, once per descriptor source. */
export const sourcePanel = (input: { pluginId: string; descriptor: PluginSourceDescriptor }): SourcePanel => ({
  regions: {
    list: () => <SourceList pluginId={input.pluginId} descriptor={input.descriptor} />,
    detail: () => <SourceDetail descriptor={input.descriptor} />,
  },
})
