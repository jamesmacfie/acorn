import { createComponent, lazy } from 'solid-js'
import type { NodePluginRow } from '@acorn/protocol/api.ts'
import { activeNodeId } from '../../node/activeNode'
import { attentionRegistry, type AttentionItem } from '../../registries/attention'
import { nodeStatRegistry } from '../../registries/nodeStats'
import { paletteRowRegistry } from '../../registries/paletteRows'
import type { Disposable } from '../../registries/registry'
import { sourceRegistry } from '../../registries/sources'
import { taskSlotRegistry } from '../../registries/slots'
import { bundleAccepted, installedByNode, pluginEnabledOnNode } from '../distribution'
import { runChromeAction } from './actions'
import { readAttention, readStat, unwatchChrome, watchChrome } from './data'
import { descriptorPromotion } from './promotion'
import { compileContentLinkPattern } from '@acorn/protocol/contentLinkPattern.ts'
import { contentLinkRegistry } from '../../registries/contentLinks'

// Turning accepted manifests into NATIVE shell contributions — the descriptor half of what
// plugins/frames/register.tsx does for rectangles (docs/plugins.md).
//
// Same shape as that file, deliberately: one module-level map of per-plugin disposables, a
// dispose-then-register pass so a re-run replaces a plugin's whole contribution set rather than
// reconciling it, and a per-surface try/catch so one duplicate id does not cost the plugin its other
// chrome. What differs is the gate, and it differs because chrome is DATA:
//
//   frames  gate on `bundleAccepted` — bytes execute, and this device said yes to these exact bytes.
//   chrome  gate on "no client bundle, OR its bundle was accepted". A descriptor executes nothing, so
//           a plugin that ships no code at all needs no trust prompt and gets its chrome. A plugin
//           whose code this device REFUSED gets none: its panes were never registered, so its chrome
//           would be offering an `openPane` that cannot land, and decorating the shell on behalf of
//           something the owner declined is the wrong answer regardless.
//
// Per-node presence stays the render-time gate. A plugin installed on node A contributes nothing to a
// surface looking at node B, because its routes are not there.

// `.tsx` behind `lazy`, so this module stays importable from a bare-Node test suite: the repo's vitest
// configs have no Solid transform, and a module that reaches a JSX file cannot be imported at all
// (registries/slots.ts explains the same split). `lazy` never resolves the import until something renders.
const ChromeSourcePanel = lazy(() => import('./ChromeSourcePanel'))
const ChromeBadge = lazy(() => import('./ChromeBadge'))

const registered = new Map<string, Disposable[]>()

// The node the rail and the task footer are looking at. There is no other candidate — a task belongs to
// whichever node the window is talking to.
const chromeNode = (): string => activeNodeId() ?? ''

// Every plugin whose chrome this device may draw, one row per plugin id. The manifest travels with the
// roster row and one version wins per id, so the first node offering it is as good as any.
function eligible(): Map<string, NodePluginRow> {
  const rows = new Map<string, NodePluginRow>()
  for (const roster of installedByNode().values()) {
    for (const row of roster) {
      if (!row.installed || rows.has(row.name)) continue
      const client = row.installed.client
      if (client && !bundleAccepted(row.name, client.hash)) continue
      rows.set(row.name, row)
    }
  }
  return rows
}

function registerChrome(pluginId: string, row: NodePluginRow, refreshes: number[]): Disposable[] {
  const contributions = row.installed!.contributions
  const disposables: Disposable[] = []
  const add = (what: string, id: string, register: () => Disposable): void => {
    try {
      disposables.push(register())
    } catch (error) {
      // A duplicate id is the expected failure: contribution ids are un-namespaced by design, so a
      // third-party descriptor can collide with a first-party source or slot.
      console.warn(`[plugin-chrome] ${pluginId} could not contribute ${what} '${id}':`, error)
    }
  }
  const note = (seconds: number | undefined): void => void (seconds !== undefined && refreshes.push(seconds))

  const panes = new Set((contributions.frames ?? []).filter((frame) => frame.target === 'pane').map((frame) => frame.id))
  for (const descriptor of contributions.contentLinks ?? []) {
    if (!panes.has(descriptor.openPane)) {
      console.warn(`[plugin-chrome] ${pluginId} content link '${descriptor.id}' names an undeclared pane '${descriptor.openPane}'.`)
      continue
    }
    add('content link', descriptor.id, () => {
      const pattern = compileContentLinkPattern(descriptor.match)
      if (!pattern.captures.includes(descriptor.item)) {
        throw new Error(`item '${descriptor.item}' is not captured by its pattern`)
      }
      return contentLinkRegistry.register({
        id: descriptor.id,
        parse: (href) => {
          const captures = pattern.match(href)
          return captures
            ? { ...captures, kind: descriptor.id, pane: descriptor.openPane, item: captures[descriptor.item] }
            : null
        },
      })
    })
  }

  for (const descriptor of contributions.sources ?? []) {
    note(descriptor.refresh)
    add('source', descriptor.id, () => sourceRegistry.register({
      id: descriptor.id,
      label: descriptor.label,
      glyph: descriptor.glyph,
      order: descriptor.order,
      ...(descriptor.providerId ? { providerId: descriptor.providerId } : {}),
      when: () => pluginEnabledOnNode(chromeNode(), pluginId),
      component: () => createComponent(ChromeSourcePanel, { pluginId, descriptor }),
      ...(descriptor.onSelect?.verb === 'createTask' ? { promotion: descriptorPromotion(pluginId) } : {}),
      // No `routes`. `SourceRouteContribution`'s `project` and `create` kinds are core-owned URLs, so a
      // descriptor source claiming them would take over project navigation for the whole shell; deep
      // links for descriptor sources want a host-minted prefix and are a later, additive decision.
    }))
  }

  for (const descriptor of contributions.slots ?? []) {
    note(descriptor.refresh)
    add('slot', descriptor.id, () => taskSlotRegistry.register({
      id: descriptor.id,
      // The manifest's one slot name. `docker-footer-badge` is the precedent, and it is a task slot.
      slot: 'task.footer',
      order: 500,
      component: () => createComponent(ChromeBadge, { pluginId, descriptor }),
    }))
  }

  const palette = contributions.palette ?? []
  if (palette.length) {
    // ONE source per plugin covering all its rows, not one per descriptor: the palette asks every source
    // when it opens, and a plugin with eight commands should be one question, not eight.
    add('palette', pluginId, () => paletteRowRegistry.register({
      id: `plugin-chrome:${pluginId}`,
      order: 500,
      rows: async () => ({
        rows: pluginEnabledOnNode(chromeNode(), pluginId)
          ? palette.map((descriptor) => ({ kind: 'plugin' as const, id: descriptor.id, label: descriptor.title }))
          : [],
      }),
      invoke: async (item) => {
        const descriptor = palette.find((candidate) => candidate.id === item.id)
        if (descriptor) runChromeAction(descriptor.action, { pluginId, nodeId: chromeNode() })
      },
    }))
  }

  for (const descriptor of contributions.attention ?? []) {
    note(descriptor.refresh)
    add('attention', descriptor.id, () => attentionRegistry.register({
      id: descriptor.id,
      order: descriptor.order,
      // Addressed per node by the inbox's fan-out, never against the ambient active node. A node that
      // does not run this plugin answers with nothing rather than being asked.
      fetch: async (nodeId, signal): Promise<AttentionItem[]> => {
        if (!pluginEnabledOnNode(nodeId, pluginId)) return []
        const items = await readAttention(pluginId, descriptor.items, nodeId, signal)
        // Namespaced with the contribution id, as registries/attention.ts requires: the id is the row
        // key across refetches, and two plugins reporting `stuck` must not collide in one merged list.
        return items.map((item) => ({ ...item, id: `${descriptor.id}:${item.id}` }))
      },
    }))
  }

  for (const descriptor of contributions.nodeStats ?? []) {
    note(descriptor.refresh)
    add('nodeStat', descriptor.id, () => nodeStatRegistry.register({
      id: descriptor.id,
      order: descriptor.order,
      label: descriptor.label,
      // `0` is hidden on the card, which is the right answer for a node that does not run this plugin.
      fetch: async (nodeId, signal) =>
        pluginEnabledOnNode(nodeId, pluginId) ? readStat(pluginId, descriptor.data, nodeId, signal) : 0,
    }))
  }

  return disposables
}

/**
 * Register every eligible plugin's declared chrome. Idempotent: called after the distribution pass and
 * again when a trust decision lands, and each call replaces what the previous one contributed.
 */
export function syncChromeContributions(): void {
  disposeAll()
  const refreshes: number[] = []
  for (const [pluginId, row] of eligible()) registered.set(pluginId, registerChrome(pluginId, row, refreshes))
  // One timer at the smallest declared interval, rather than one per descriptor. The polling fallback is
  // for data that changes with no node-side trigger; the primary path is still the status ping, and a
  // handful of tiny reads sharing a tick is not worth five timers.
  //
  // Not a `pollerContribution`: `startClientPollers()` snapshots the registry once at app mount, and this
  // pass runs after the distribution round trip — a poller registered here would never be started.
  if (registered.size) watchChrome(refreshes.length ? Math.min(...refreshes) : undefined)
  else unwatchChrome()
}

function disposeAll(): void {
  for (const disposables of registered.values()) for (const disposable of disposables.reverse()) disposable.dispose()
  registered.clear()
}

/** Test seam, mirroring _resetFrameContributions: the registries are module-level, so a suite that
 * asserts on one pass must not inherit the previous one's contributions. */
export function _resetChromeContributions(): void {
  disposeAll()
  unwatchChrome()
}
