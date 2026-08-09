import { For, Show } from 'solid-js'
import type { PluginSourceDescriptor } from '@acorn/protocol/api.ts'
import { activeNodeId } from '../../node/activeNode'
import { createFleetQuery } from '../../node/fanout'
import { FRESHNESS_LABELS } from '../../node/freshness'
import { Badge, Row, SectionHeader } from '../../ui/primitives'
import Icon from '../../ui/Icon'
import { runChromeAction } from './actions'
import { chromeKey, chromeRevision, readRailItems } from './data'

// The ONE rail list every descriptor source renders through
// (docs/third-party/phase-4-declarative-chrome.md § Host adapters).
//
// Native by construction: `Row`, `Badge` and `Icon` are the shell's own primitives, so a third-party
// rail list is pixel-identical to a first-party one under every appearance pack, and stays that way
// when a pack changes. That is the argument for descriptors over frames at this size — not the cost of
// an iframe, but that the iframe could never look like this.

export type ChromeSourcePanelProps = { pluginId: string; descriptor: PluginSourceDescriptor }

export default function ChromeSourcePanel(props: ChromeSourcePanelProps) {
  // Captured at creation, not read per render. A node switch swaps the QueryClient provider this panel
  // sits under, which remounts it — the same reasoning plugins/frames/register.tsx gives for reading
  // `activeNodeId()` at frame construction.
  const nodeId = activeNodeId() ?? ''

  // The fan-out rather than a bare resource, pinned to one node: it is the only reader in the codebase
  // that already has a per-node deadline, a cache fallback and the live/stale/offline vocabulary. An
  // offline node shows the list it last had, badged stale, exactly like every native surface.
  const [result] = createFleetQuery(
    () => chromeKey(props.pluginId, props.descriptor.id),
    (node, _revision, signal) => readRailItems(props.pluginId, props.descriptor.items, node, signal),
    chromeRevision,
    { nodeIds: [nodeId] },
  )

  const row = () => result().rows[0]
  const items = () => row()?.data ?? []
  const unavailable = () => result().unavailable[0]

  const select = (item: string): void => {
    if (props.descriptor.onSelect) runChromeAction(props.descriptor.onSelect, { pluginId: props.pluginId, nodeId, item })
  }

  return (
    <main class="panes">
      <section class="pane pane-left">
        <SectionHeader
          count={items().length}
          actions={<Show when={row() && row()!.freshness !== 'live'}><span class="muted">{FRESHNESS_LABELS[row()!.freshness]}</span></Show>}
        >
          {props.descriptor.label}
        </SectionHeader>

        {/* A node that did not answer and had nothing cached is a banner, never a failed pane. */}
        <Show when={unavailable()}>
          {(entry) => <div class="action-error" role="alert">{entry().label} unavailable — {entry().reason}</div>}
        </Show>

        <Show
          when={row()}
          fallback={<p class="placeholder">{unavailable() ? 'No cached items.' : 'Loading…'}</p>}
        >
          <For each={items()} fallback={<p class="placeholder">Nothing here yet.</p>}>
            {(item) => (
              <Row
                onActivate={props.descriptor.onSelect ? () => select(item.id) : undefined}
                leading={<Show when={item.icon}>{(name) => <Icon name={name()} />}</Show>}
                meta={<Show when={item.subtitle}>{(subtitle) => <span class="muted">{subtitle()}</span>}</Show>}
                trailing={<Show when={item.badge}>{(badge) => <Badge>{badge()}</Badge>}</Show>}
                title={item.title}
              >
                {item.title}
              </Row>
            )}
          </For>
        </Show>
      </section>
    </main>
  )
}
