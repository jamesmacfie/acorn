import { For, Show } from 'solid-js'
import type { PluginExtensionItem } from '@acorn/protocol/extensionPoints.ts'
import { activeNodeId } from '../../node/activeNode'
import { createFleetQuery } from '../../node/fanout'
import { extensionDeliveries, type ExtensionContribution } from '../../registries/extensionPoints'
import { Badge, Row, SectionHeader } from '../../ui/primitives'
import Icon from '../../ui/Icon'
import { chromeKey, chromeRevision } from './data'
import './extension-points.css'

// The one place another plugin's rows are drawn inside a plugin's surface, by the host, with the
// shell's own primitives, from data (docs/plugins.md § Cooperative extension points).
//
// `Row`, `Badge`, `SectionHeader` and `Icon` are the same primitives the descriptor rail list uses, so a
// contributed section is pixel-identical to a first-party one under every appearance pack.
//
// The decisions are all in registries/extensionPoints.ts, which is JSX-free and has a test: which point
// resolves, whether either side is running, the ordering. This file is a `<For>` over the answer.

function ExtensionGroup(props: { contribution: ExtensionContribution }) {
  const nodeId = activeNodeId() ?? ''
  const [result] = createFleetQuery(
    () => chromeKey(props.contribution.pluginId, props.contribution.id),
    // The node is already bound into `fetch` by the chrome pass, from the surface's own active node.
    // The fan-out's parameter is the same value and is not read again here.
    //
    // A contributor whose node is unreachable contributes nothing, which is the same answer as a
    // contributor with nothing to say. The owner's pane is not the place to report somebody else's
    // fetch failure; the node's own banner already covers an unreachable node.
    (_node, _revision, signal) => props.contribution.fetch(signal).catch((): PluginExtensionItem[] => []),
    chromeRevision,
    { nodeIds: [nodeId] },
  )
  const items = (): PluginExtensionItem[] => result().rows[0]?.data ?? []

  return (
    <Show when={items().length}>
      <section class="extension-group">
        <SectionHeader
          level="group"
          // The stamp: not a decoration and not shortenable to an icon. See docs/plugins.md §
          // Cooperative extension points for why provenance is drawn rather than only recorded.
          actions={<span class="muted extension-group-owner">{props.contribution.pluginId}</span>}
        >
          {props.contribution.label}
        </SectionHeader>
        <For each={items()}>
          {(item) => (
            <Row
              density="compact"
              leading={<Show when={item.icon}>{(name) => <Icon name={name()} />}</Show>}
              trailing={<Show when={item.badge}>{(badge) => <Badge>{badge()}</Badge>}</Show>}
              meta={<Show when={item.subtitle}>{(subtitle) => <span class="muted">{subtitle()}</span>}</Show>}
              {...(props.contribution.run ? { onActivate: () => props.contribution.run!(item) } : {})}
            >
              {item.title}
            </Row>
          )}
        </For>
      </section>
    </Show>
  )
}

/** Everything delivered into one point, or nothing at all. Renders no chrome of its own when the point
 *  has no deliveries: an owner who reserved a strip nobody fills sees their pane exactly as it was. */
export default function ExtensionPointHost(props: { pointId: string }) {
  return (
    <Show when={extensionDeliveries(props.pointId).length}>
      <div class="extension-point" data-point={props.pointId}>
        <For each={extensionDeliveries(props.pointId)}>
          {(contribution) => <ExtensionGroup contribution={contribution} />}
        </For>
      </div>
    </Show>
  )
}
