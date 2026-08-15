import { For, Show } from 'solid-js'
import type { PluginExtensionItem } from '@acorn/protocol/extensionPoints.ts'
import { activeNodeId } from '../../node/activeNode'
import { createFleetQuery } from '../../node/fanout'
import { extensionDeliveries, type ExtensionContribution } from '../../registries/extensionPoints'
import { Badge, Row, SectionHeader } from '../../ui/primitives'
import Icon from '../../ui/Icon'
import { chromeKey, chromeRevision } from './data'
import './extension-points.css'

// The one place another plugin's rows are drawn inside a plugin's surface — and they are drawn by the
// HOST, with the shell's own primitives, from data.
//
// `Row`, `Badge`, `SectionHeader` and `Icon` are the same primitives the descriptor rail list uses, so a
// contributed section is pixel-identical to a first-party one under every appearance pack. That is the
// argument for descriptors over any in-realm alternative at this size: not the cost, but that nothing
// running inside the owner's frame could look like this, and nothing running inside the owner's frame
// should be somebody else's code in the first place.
//
// PROVENANCE IS DRAWN, not just recorded. Every group carries the contributing plugin's id beside its
// label, because a section appearing inside another plugin's pane is exactly the situation where "whose
// is this?" has to have an answer on screen. The id comes off the registry entry, which the chrome pass
// stamped from the manifest it read — never from anything the contribution's route returned.
//
// The DECISIONS are all in registries/extensionPoints.ts, which is JSX-free and has a test: which point
// resolves, whether either side is running, the ordering. This file is a `<For>` over the answer.

function ExtensionGroup(props: { contribution: ExtensionContribution }) {
  const nodeId = activeNodeId() ?? ''
  const [result] = createFleetQuery(
    () => chromeKey(props.contribution.pluginId, props.contribution.id),
    // The node is already bound into `fetch` by the chrome pass, from the surface's own active node —
    // the fan-out's parameter is the same value and is not read again here.
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
          // The stamp. Not a decoration and not shortenable to an icon: the whole promise of the seam is
          // that an owner can tell which package put a row in front of them.
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
 *  has no deliveries — an owner who reserved a strip nobody fills sees their pane exactly as it was. */
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
