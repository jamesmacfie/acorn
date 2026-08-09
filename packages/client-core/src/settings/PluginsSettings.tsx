import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import type { NodePluginRow, NodePluginState } from '@acorn/protocol/api.ts'
import { activeNodeId } from '../node/activeNode'
import { nodes } from '../node/fleet'
import { restartLocalNode } from '../node/fleetActions'
import { refreshNodePlugins, saveDisabledNodePlugins } from '../node/nodePlugins'
import { readPluginHostState } from '../plugins/host'
import { Button, Select } from '../ui/primitives'
import { nextDisabledList, pluginPending } from './pluginToggle'
import './settings.css'

// Settings → Plugins (docs/ui-design.md § New surfaces: "the list of plugins with enable/disable toggles
// (per node)").
//
// Per NODE, and the node picker at the top is the whole reason this is not a plain list: which plugins a
// node runs decides which routes exist and which SQLite files it opens, so "disable docker" is a statement
// about one machine. The build box may want docker off and the laptop may want it on.
//
// Two facts per row, not one. A toggle takes effect at the node's next start — a plugin's routes, tables
// and jobs are wired at init — so between saving and restarting, `disabled` (what will happen) and
// `running` (what is happening) differ. Collapsing them would either lie about the checkbox or lose the
// banner, and this page is the only place the owner can see the difference.
export default function PluginsSettings() {
  const [target, setTarget] = createSignal<string | null>(null)
  const nodeId = () => target() ?? activeNodeId()
  const node = () => nodes().find((candidate) => candidate.nodeId === nodeId()) ?? null
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  const [state, { mutate, refetch }] = createResource<NodePluginState | null, string>(
    () => nodeId() ?? '',
    async (id) => (id ? await refreshNodePlugins(id) : null),
  )

  const rows = createMemo<NodePluginRow[]>(() => state()?.plugins ?? [])
  // A required plugin cannot be disabled, so it is not a checkbox — the route refuses one and the host
  // ignores it, and offering the control would be an affordance that silently does nothing.
  const optional = createMemo(() => rows().filter((row) => !row.required))
  const required = createMemo(() => rows().filter((row) => row.required))
  const restartRequired = () => state()?.restartRequired === true

  // The device's own answer, which the node knows nothing about: it served the bundle, and this
  // machine declined to run it (plugins/distribution.ts). Read once per mount rather than kept live —
  // a decision only changes through the trust dialog, which is modal over this page.
  const [acks] = createResource(async () => (await readPluginHostState()).acks)
  const blockedHere = (row: NodePluginRow): boolean => {
    const hash = row.installed?.client?.hash
    return !!hash && (acks() ?? []).some((ack) => ack.pluginId === row.name && ack.hash === hash && ack.decision === 'rejected')
  }

  const toggle = async (name: string, disabled: boolean) => {
    setError('')
    setBusy(true)
    try {
      mutate(await saveDisabledNodePlugins(nextDisabledList(rows(), name, disabled), nodeId() ?? undefined))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const restart = async () => {
    setError('')
    setBusy(true)
    try {
      await restartLocalNode()
      // The renderer is reloaded by main after a successful restart, so this refetch only matters when it
      // is not (a build with no supervision) — in which case the list should still be re-read.
      await refetch()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="settings-section">
      <Show when={nodes().length > 1}>
        <label class="settings-field">
          <span>Node</span>
          <Select value={nodeId() ?? ''} onChange={(event) => setTarget(event.currentTarget.value || null)}>
            <For each={nodes()}>{(candidate) => <option value={candidate.nodeId}>{candidate.label}</option>}</For>
          </Select>
        </label>
      </Show>

      <p class="muted">
        Which plugins <strong>{node()?.label ?? 'this node'}</strong> runs. A change takes effect when the
        node restarts; its data is left in place either way.
      </p>

      <Show when={restartRequired()}>
        <div class="settings-notice" role="status">
          <span>This node is still running the previous set of plugins.</span>
          <Show
            when={node()?.local}
            fallback={<span class="muted">Restart it on its own machine to apply the change.</span>}
          >
            <Button size="sm" disabled={busy()} onClick={() => void restart()}>Restart node</Button>
          </Show>
        </div>
      </Show>

      <Show when={error()}><div class="action-error" role="alert">{error()}</div></Show>
      <Show when={state.loading && !state()}><p class="muted">Reading the plugin list…</p></Show>
      {/* A node that cannot answer is not an empty list. Saying so beats rendering nothing, which reads as
          "this node has no plugins". */}
      <Show when={!state.loading && !rows().length}>
        <p class="muted">This node did not report a plugin list. It may be offline.</p>
      </Show>

      <ul class="plugin-list">
        <For each={optional()}>
          {(row) => (
            <li class="plugin-row">
              <label>
                <input
                  type="checkbox"
                  checked={!row.disabled}
                  disabled={busy()}
                  onChange={(event) => void toggle(row.name, !event.currentTarget.checked)}
                />
                <span class="plugin-name">{row.name}</span>
              </label>
              {/* Only a plugin that came off this node's disk has a version worth showing; a built-in's
                  is the app's. Absence of the block is also how the owner tells the two apart. */}
              <Show when={row.installed}>
                {(installed) => <span class="plugin-version muted">{installed().version}</span>}
              </Show>
              {/* This device has seen these exact bytes and said no. Per-device by design, hence the
                  wording: the same plugin may be running happily on the owner's other laptop. */}
              <Show when={blockedHere(row)}>
                <span class="plugin-failed" role="status">blocked on this device</span>
              </Show>
              {/* Only when the two answers differ — otherwise every row would carry a redundant label. */}
              <Show when={pluginPending(row)}>
                <span class="plugin-pending muted">{row.running ? 'still running' : 'not loaded'}</span>
              </Show>
              {/* A plugin installed on this node whose start-up threw. Restarting will not fix it, so
                  this deliberately does not raise the restart banner — the owner has to turn it off or
                  fix the plugin. */}
              <Show when={row.state === 'failed'}>
                <span class="plugin-failed" role="status">failed to start</span>
              </Show>
            </li>
          )}
        </For>
      </ul>

      <Show when={required().length}>
        <p class="muted">
          Always on: {required().map((row) => row.name).join(', ')}. Core assumes their capabilities exist,
          so a node without them would start and then fail at the first task.
        </p>
      </Show>
    </div>
  )
}
