import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import type { NodePluginRow, NodePluginState, PluginInstallSource } from '@acorn/protocol/api.ts'
import { activeNodeId } from '../node/activeNode'
import { nodes } from '../node/fleet'
import { restartLocalNode } from '../node/fleetActions'
import {
  installNodePlugin,
  refreshNodePlugins,
  saveDisabledNodePlugins,
  uninstallNodePlugin,
  updateNodePlugin,
} from '../node/nodePlugins'
import { readPluginHostState } from '../plugins/host'
import { syncPluginDistribution } from '../plugins/distribution'
import { Button, Input, Select } from '../ui/primitives'
import { nextDisabledList, pluginPending } from './pluginToggle'
import './settings.css'

// Settings → Plugins (docs/ui-design.md § New surfaces: "the list of plugins with enable/disable toggles
// (per node)"), and since phase 5 the whole install lifecycle as well
// (docs/third-party/phase-5-install-ux.md § Client-side UX).
//
// Per NODE, and the node picker at the top is the whole reason this is not a plain list: which plugins a
// node runs decides which routes exist and which SQLite files it opens, so "disable docker" is a statement
// about one machine. The build box may want docker off and the laptop may want it on. Install is per node
// for the same reason, and more strongly — a fleet is a set of independently administered nodes, so there
// is no "install everywhere" here and no pretending there could be.
//
// Two facts per row, not one. A toggle takes effect at the node's next start — a plugin's routes, tables
// and jobs are wired at init — so between saving and restarting, `disabled` (what will happen) and
// `running` (what is happening) differ. Collapsing them would either lie about the checkbox or lose the
// banner, and this page is the only place the owner can see the difference. An install has exactly the
// same shape, which is why it reuses the same banner rather than growing its own.

type SourceKind = 'github' | 'npm' | 'url' | 'path'

const PLACEHOLDER: Record<SourceKind, string> = {
  github: 'owner/repo, or owner/repo@v1.2.0',
  npm: 'package-name, or package-name@1.2.0',
  url: 'https://example.com/acorn-plugin.tgz',
  path: '/absolute/path/to/the/plugin',
}

// `name@version` collapsed into one field rather than two, because that is how everyone already writes
// it. The split is on the LAST '@' and only past position 0, so a scoped npm name (`@scope/pkg`) keeps
// its own.
export function buildInstallSource(kind: SourceKind, raw: string): PluginInstallSource {
  const text = raw.trim()
  if (kind === 'url') return { url: text }
  if (kind === 'path') return { path: text }
  const at = text.lastIndexOf('@')
  const name = at > 0 ? text.slice(0, at) : text
  const suffix = at > 0 ? text.slice(at + 1) : ''
  return kind === 'github'
    ? { github: name, ...(suffix ? { tag: suffix } : {}) }
    : { npm: name, ...(suffix ? { version: suffix } : {}) }
}

export default function PluginsSettings() {
  const [target, setTarget] = createSignal<string | null>(null)
  const nodeId = () => target() ?? activeNodeId()
  const node = () => nodes().find((candidate) => candidate.nodeId === nodeId()) ?? null
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [kind, setKind] = createSignal<SourceKind>('github')
  const [spec, setSpec] = createSignal('')
  // Which row is mid-uninstall. Inline rather than a modal because the question is not yes/no — keeping
  // or deleting the plugin's data is a third answer, and burying it in a checkbox inside a confirmation
  // is how someone deletes a year of notes by reflex.
  const [removing, setRemoving] = createSignal<string | null>(null)

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

  const run = async (work: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await work()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (name: string, disabled: boolean) =>
    run(async () => {
      mutate(await saveDisabledNodePlugins(nextDisabledList(rows(), name, disabled), nodeId() ?? undefined))
    })

  const restart = () =>
    run(async () => {
      await restartLocalNode()
      // The renderer is reloaded by main after a successful restart, so this refetch only matters when it
      // is not (a build with no supervision) — in which case the list should still be re-read.
      await refetch()
    })

  // The node has the package; this device has not seen its bytes yet. The boot pass is what fetches them,
  // hashes them locally and queues the trust prompt — so an install walks straight into consent rather
  // than waiting for the next launch to ask (plugins/distribution.ts).
  const settle = async () => {
    await refetch()
    await syncPluginDistribution()
  }

  const install = () =>
    run(async () => {
      const source = buildInstallSource(kind(), spec())
      await installNodePlugin(source, {}, nodeId() ?? undefined)
      setSpec('')
      await settle()
    })

  // No background checking and no "an update is available" badge: re-resolving every source on every
  // roster read would mean this page phones GitHub for each installed plugin, and an update is the one
  // moment a compromised maintainer gets to run new code (docs/third-party/node-security.md § Supply
  // chain). The owner asks, and the node answers with whatever the source resolves to now.
  const update = (id: string) =>
    run(async () => {
      const result = await updateNodePlugin(id, {}, nodeId() ?? undefined)
      if (result.fromVersion === result.toVersion) setError(`${id} is already at ${result.toVersion}.`)
      await settle()
    })

  const uninstall = (id: string, purgeData: boolean) =>
    run(async () => {
      await uninstallNodePlugin(id, { purgeData }, nodeId() ?? undefined)
      setRemoving(null)
      await refetch()
    })

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

      {/* The install form. Deliberately plain: there is no browse-and-discover surface and there is not
          going to be one soon, because any listing acorn could offer would be unreviewed
          (docs/third-party/README.md § Non-goals). Someone who installs a plugin here already decided to
          trust its author. */}
      <form
        class="plugin-install"
        onSubmit={(event) => {
          event.preventDefault()
          if (spec().trim()) void install()
        }}
      >
        <Select value={kind()} width="auto" onChange={(event) => setKind(event.currentTarget.value as SourceKind)}>
          <option value="github">GitHub release</option>
          <option value="npm">npm package</option>
          <option value="url">Tarball URL</option>
          <option value="path">Local folder</option>
        </Select>
        <Input
          value={spec()}
          placeholder={PLACEHOLDER[kind()]}
          disabled={busy()}
          onInput={(event) => setSpec(event.currentTarget.value)}
        />
        <Button type="submit" disabled={busy() || !spec().trim()}>Install</Button>
      </form>
      <p class="muted plugin-install-hint">
        A plugin's server code runs with the same access as acorn itself. This device asks again, showing
        what the plugin declared, before any of its interface code runs here.
      </p>

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
                {(installed) => (
                  <>
                    <span class="plugin-version muted">{installed().version}</span>
                    <Show when={installed().source}>
                      {(source) => <span class="plugin-source muted">{source()}</span>}
                    </Show>
                  </>
                )}
              </Show>
              {/* This device has seen these exact bytes and said no. Per-device by design, hence the
                  wording: the same plugin may be running happily on the owner's other laptop. */}
              <Show when={blockedHere(row)}>
                <span class="plugin-failed" role="status">blocked on this device</span>
              </Show>
              {/* The install directory and this process disagree — installed, updated or uninstalled
                  since the node last started. Unlike a failed row, a restart is exactly the fix. */}
              <Show when={row.state === 'pending-restart'}>
                <span class="plugin-pending muted">waiting for a restart</span>
              </Show>
              {/* Only when the two answers differ — otherwise every row would carry a redundant label. */}
              <Show when={row.state !== 'pending-restart' && pluginPending(row)}>
                <span class="plugin-pending muted">{row.running ? 'still running' : 'not loaded'}</span>
              </Show>
              {/* A plugin installed on this node whose start-up threw. Restarting will not fix it, so
                  this deliberately does not raise the restart banner — the owner has to turn it off or
                  fix the plugin. */}
              <Show when={row.state === 'failed'}>
                <span class="plugin-failed" role="status">failed to start</span>
              </Show>

              {/* Only a package that came off disk can be updated or removed; a built-in ships with the
                  app and goes away when the app does. */}
              <Show when={row.installed}>
                <span class="plugin-actions">
                  <Show
                    when={removing() === row.name}
                    fallback={
                      <>
                        <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void update(row.name)}>
                          Update
                        </Button>
                        <Button size="sm" variant="ghost" tone="danger" disabled={busy()} onClick={() => setRemoving(row.name)}>
                          Uninstall
                        </Button>
                      </>
                    }
                  >
                    {/* Keeping the data is the default everywhere else a plugin goes away — disabling one
                        leaves its SQLite file alone (docs/plugins.md) — so it is the plain button here and
                        deleting is the loud one. */}
                    <span class="plugin-confirm">Remove {row.name}?</span>
                    <Button size="sm" disabled={busy()} onClick={() => void uninstall(row.name, false)}>
                      Keep its data
                    </Button>
                    <Button size="sm" tone="danger" disabled={busy()} onClick={() => void uninstall(row.name, true)}>
                      Delete its data
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy()} onClick={() => setRemoving(null)}>
                      Cancel
                    </Button>
                  </Show>
                </span>
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
