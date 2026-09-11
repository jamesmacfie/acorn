import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { NodePluginRow, NodePluginState, PluginInstallSource } from '@acorn/protocol/api.ts'
import { sendReferenceToAgent } from '../agent/reference'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodes } from '../../infra/node/fleet'
import { restartLocalNode } from '../../infra/node/fleetActions'
import {
  installNodePlugin,
  refreshNodePlugins,
  saveDisabledNodePlugins,
  uninstallNodePlugin,
  updateNodePlugin,
} from '../../infra/node/nodePlugins'
import { canPickFolder, pickFolder } from '../../infra/platform'
import { readPluginHostState, setPluginDevGrant } from '../../host/plugins/host'
import { syncPluginDistribution } from '../../host/plugins/distribution'
import { Alert, Button, Checkbox, Field, Input, Select } from '../../kit/components/primitives'
import Icon from '../../kit/components/content/Icon'
import { activeTaskId } from '../tasks/tasks'
import { nextDisabledList, pluginPending } from './pluginToggle'
import { CORE_EXCLUSIVE_SLOTS } from '@acorn/protocol/extensionPoints.ts'
import { prefsOptions } from '../../infra/queries'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { savePref } from './savePref'
import ExtensionPointsDev from './ExtensionPointsDev'
import {
  CORE_SLOT_PROVIDER,
  exclusiveSlotChoices,
  exclusiveSlotFailed,
  exclusiveSlotOffers,
  withExclusiveSlotChoice,
  type CoreExclusiveSlot,
} from '../../host/registries/extensionPoints/exclusiveSlots'
import './settings.css'

// Settings > Plugins: per-node install, toggle, and the install lifecycle (docs/plugins.md
// § Activation). Per node, because a fleet is a set of independently administered nodes.
//
// Each row carries two facts: `disabled`, what happens at the node's next start, and `running`,
// what is happening now. They diverge between saving and restarting, and this page is the only
// place the owner sees the difference.

type SourceKind = 'github' | 'npm' | 'url' | 'path'

const PLACEHOLDER: Record<SourceKind, string> = {
  github: 'owner/repo, or owner/repo@v1.2.0',
  npm: 'package-name, or package-name@1.2.0',
  url: 'https://example.com/acorn-plugin.tgz',
  path: '/absolute/path/to/the/plugin',
}

// `name@version` is one field because that is how everyone writes it. The split is on the last `@`
// past position 0, so a scoped npm name keeps its own.
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

// The seeded prompt behind "Create a plugin" (docs/plugins.md § Teaching the agent). The teaching
// lives in the `plugin_authoring` tool this text names, not in the text; that tool's test asserts
// this file still names it.
export const PLUGIN_STARTER_PROMPT = `I want to extend acorn with a plugin.

Call the \`plugin_authoring\` tool first. It returns the authoring contract and this node's own manifest
vocabulary, and an answer from memory will be wrong. Then write the package and ask me for it with
\`plugin_request\` using \`dev: true\`, so I approve once and you can iterate.

What it should do: `

export default function PluginsSettings() {
  const [target, setTarget] = createSignal<string | null>(null)
  const nodeId = () => target() ?? activeNodeId()
  const node = () => nodes().find((candidate) => candidate.nodeId === nodeId()) ?? null
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [kind, setKind] = createSignal<SourceKind>('github')
  const [spec, setSpec] = createSignal('')
  // Which row is mid-uninstall. Inline rather than a modal, because keeping or deleting the
  // plugin's data is a third answer, not yes or no, and a checkbox inside a confirmation is how
  // someone deletes a year of notes by reflex.
  const [removing, setRemoving] = createSignal<string | null>(null)

  const [state, { mutate, refetch }] = createResource<NodePluginState | null, string>(
    () => nodeId() ?? '',
    async (id) => (id ? await refreshNodePlugins(id) : null),
  )

  const rows = createMemo<NodePluginRow[]>(() => state()?.plugins ?? [])
  // A required plugin cannot be disabled, so it gets no checkbox and the page does not list it.
  // There is nothing an owner could do to the row.
  const optional = createMemo(() => rows().filter((row) => !row.required))
  const restartRequired = () => state()?.restartRequired === true

  // The device's own answers, which the node knows nothing about: it served the bundle, and this
  // machine declined to run it, or put it into development mode (docs/security.md § The dev grant).
  const [custody, { refetch: refetchCustody }] = createResource(async () => await readPluginHostState())
  const blockedHere = (row: NodePluginRow): boolean => {
    const hash = row.installed?.client?.hash
    return !!hash && (custody()?.acks ?? []).some((ack) => ack.pluginId === row.name && ack.hash === hash && ack.decision === 'rejected')
  }
  // A plugin in development on this device, against this node (docs/security.md § The dev grant).
  // Both halves matter: the same plugin may be a plain install on the owner's other laptop, and a
  // bundle offered under this name by a different node is not covered.
  const devGrant = (row: NodePluginRow) =>
    (custody()?.devGrants ?? []).find((grant) => grant.pluginId === row.name && grant.nodeId === nodeId())

  // Ending development mode drops the grant and every acknowledgement it wrote, so the plugin
  // re-enters per-hash trust at the current bundle (docs/security.md § The dev grant).
  const endDevMode = (row: NodePluginRow) =>
    run(async () => {
      await setPluginDevGrant({ pluginId: row.name, nodeId: nodeId() ?? '', grant: false })
      await refetchCustody()
      await syncPluginDistribution()
    })

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
      // Main reloads the renderer after a successful restart, so this refetch only matters when
      // that did not happen and the list still needs a re-read.
      await refetch()
    })

  // The node has the package; this device has not seen its bytes (docs/security.md § Third-party
  // plugin bundles). Fetching and hashing them here queues the trust prompt, so an install walks
  // straight into consent instead of waiting for the next launch to ask.
  const settle = async () => {
    await refetch()
    await syncPluginDistribution()
  }

  // The agent writes the package; the owner still installs it (docs/plugins.md § Approval-mediated
  // install). This button reaches an agent, never the install route.
  const createPlugin = () =>
    run(async () => {
      const taskId = activeTaskId()
      if (!taskId) throw new Error('Open a task first — the prompt is delivered to that task’s agent.')
      const result = await sendReferenceToAgent(taskId, PLUGIN_STARTER_PROMPT)
      if (!result.ok) throw new Error(result.reason ?? 'That task has no agent session to send to.')
    })

  // Local nodes only: the dialog browses this device's filesystem but the node resolves the path,
  // so picking a folder for a remote node hands it a path that means something else there. Remote
  // nodes keep the text field.
  const canBrowse = () => kind() === 'path' && node()?.local === true && canPickFolder()

  const browse = () =>
    run(async () => {
      const path = await pickFolder()
      if (path) setSpec(path)
    })

  const install = () =>
    run(async () => {
      const source = buildInstallSource(kind(), spec())
      await installNodePlugin(source, {}, nodeId() ?? undefined)
      setSpec('')
      await settle()
    })

  // No background checking and no "an update is available" badge (docs/security.md § Supply chain).
  // Re-resolving every source on every roster read would phone the provider for each installed
  // plugin, and an update is the one moment a compromised maintainer gets to run new code.
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
          <Select value={nodeId() ?? ''} onChange={(value) => setTarget(value || null)} options={[...nodes().map((candidate) => ({ value: candidate.nodeId, label: candidate.label }))]} />
        </label>
      </Show>

      <Show when={restartRequired()}>
        <Alert
          tone="warn"
          variant="banner"
          actions={
            <Show when={node()?.local} fallback={<span class="muted">Restart it on its own machine to apply the change.</span>}>
              <Button size="sm" disabled={busy()} onPress={() => void restart()}>Restart node</Button>
            </Show>
          }
        >
          This node is still running the previous set of plugins.
        </Alert>
      </Show>

      <Show when={error()}><Alert>{error()}</Alert></Show>

      {/* The agent is the other way a plugin gets here. This lands a draft in the task's composer
          rather than starting a turn, because a settings button that silently starts an agent turn
          is one nobody presses twice. */}
      <div class="plugin-authoring">
        <p class="muted">
          Drafts a prompt in the current task's agent. It writes the package and asks you to install it;
          it cannot install anything itself.
        </p>
        <Button size="sm" disabled={busy()} onPress={() => void createPlugin()}>
          Create a plugin
        </Button>
      </div>

      {/* No browse-and-discover surface, because any listing acorn could offer would be unreviewed
          (docs/plugins.md § Non-goals). */}
      <form
        class="plugin-install"
        onSubmit={(event) => {
          event.preventDefault()
          if (spec().trim()) void install()
        }}
      >
        <Select value={kind()} width="auto" onChange={(value) => setKind(value as SourceKind)} options={[{ value: 'github', label: 'GitHub release' }, { value: 'npm', label: 'npm package' }, { value: 'url', label: 'Tarball URL' }, { value: 'path', label: 'Local folder' }]} />
        <Input
          value={spec()}
          placeholder={PLACEHOLDER[kind()]}
          disabled={busy()}
          onInput={(value) => setSpec(value)}
        />
        <Show when={canBrowse()}>
          <Button variant="ghost" disabled={busy()} onPress={() => void browse()}>Choose…</Button>
        </Show>
        <Button submit disabled={busy() || !spec().trim()}>Install</Button>
      </form>
      <p class="muted plugin-install-hint">
        A plugin's server code runs in an isolated, permission-scoped realm. This device asks again,
        showing its enforced grants, before any of its interface code runs here.
      </p>
      {/* A folder is symlinked, not copied, so it is the one install whose bytes keep changing after
          the fact (docs/security.md § Installing from a folder). */}
      <Show when={kind() === 'path'}>
        <p class="muted plugin-install-hint">
          A folder is linked, not copied: whatever is in it when the node next starts is what runs, and
          acorn cannot pin those bytes the way it pins a downloaded package.
        </p>
      </Show>

      <Show when={state.loading && !state()}><p class="muted">Reading the plugin list…</p></Show>
      {/* A node that cannot answer is not an empty list; rendering nothing would read as one. */}
      <Show when={!state.loading && !rows().length}>
        <p class="muted">This node did not report a plugin list. It may be offline.</p>
      </Show>

      {/* A grid, not a flex line per row, so checkboxes, names, versions, and actions keep a straight
          column edge however long a name runs. An absent version is an empty cell, not a shifted
          column. */}
      <ul class="plugin-list">
        <For each={optional()}>
          {(row) => (
            <li class="plugin-row">
              <Checkbox
                label={<span class="plugin-name">{row.name}</span>}
                checked={!row.disabled}
                disabled={busy()}
                onChange={(checked) => void toggle(row.name, !checked)}
              />
              {/* Only a plugin off this node's disk has a version worth showing; a built-in's is the
                  app's, and the empty cell is how the owner tells the two apart. */}
              <span class="plugin-version muted">{row.installed?.version ?? ''}</span>
              <span class="plugin-meta">
                <Show when={row.installed?.source}>
                  {(source) => <span class="plugin-source muted" title={source()}>{source()}</span>}
                </Show>
                {/* Stated in full rather than as a decoration. The security story rests on the owner
                    seeing this and being able to end it (docs/security.md § The dev grant). */}
                <Show when={devGrant(row)}>
                  {(grant) => (
                    <>
                      <span class="plugin-dev" role="status" title={grant().path}>
                        in development — bundle changes are auto-trusted
                      </span>
                      <Button size="sm" variant="ghost" disabled={busy()} onPress={() => void endDevMode(row)}>
                        End dev mode
                      </Button>
                    </>
                  )}
                </Show>
                {/* This device has seen these exact bytes and said no. The same plugin may be running
                    happily on the owner's other laptop, hence the wording. */}
                <Show when={blockedHere(row)}>
                  <span class="plugin-failed" role="status">blocked on this device</span>
                </Show>
                {/* The install directory and this process disagree: something was installed, updated,
                    or uninstalled since the node last started. A restart is the fix. */}
                <Show when={row.state === 'pending-restart'}>
                  <span class="plugin-pending muted">waiting for a restart</span>
                </Show>
                <Show when={row.state !== 'pending-restart' && pluginPending(row)}>
                  <span class="plugin-pending muted">{row.running ? 'still running' : 'not loaded'}</span>
                </Show>
                {/* A restart fixes neither a throw nor a failed load, so this does not raise the
                    restart banner. The owner has to turn the plugin off or fix it.

                    `reason` is the node's verbatim account of what broke, so it is loaded-plugin text
                    crossing into the owner's UI: interpolated as text, and capped by the node. An
                    older node does not send it, which is why the label stands alone. */}
                <Show when={row.state === 'failed'}>
                  <span class="plugin-failed" role="status">
                    failed to {row.stage === 'load' ? 'load' : 'start'}
                  </span>
                  <Show when={row.reason}>
                    {(reason) => <span class="plugin-failed-reason muted" title={reason()}>{reason()}</span>}
                  </Show>
                </Show>
              </span>

              {/* Only a package the owner installed can be updated or removed. A bundled package has
                  no lockfile, so the node cannot re-resolve a source for it, and the next build brings
                  it back at the app's version anyway. */}
              <span class="plugin-actions">
                <Show when={row.installed && !row.installed.bundled}>
                  <Show
                    when={removing() === row.name}
                    fallback={
                      <>
                        <Button size="sm" variant="ghost" iconOnly label={`Update ${row.name}`} title="Update" disabled={busy()} onPress={() => void update(row.name)}>
                          <Icon name="refresh-cw" />
                        </Button>
                        <Button size="sm" variant="ghost" tone="danger" iconOnly label={`Uninstall ${row.name}`} title="Uninstall" disabled={busy()} onPress={() => setRemoving(row.name)}>
                          <Icon name="trash-2" />
                        </Button>
                      </>
                    }
                  >
                    {/* Keeping the data is the default everywhere else a plugin goes away, so it is
                        the plain button here and deleting is the loud one. */}
                    <span class="plugin-confirm">Remove {row.name}?</span>
                    <Button size="sm" disabled={busy()} onPress={() => void uninstall(row.name, false)}>
                      Keep its data
                    </Button>
                    <Button size="sm" tone="danger" disabled={busy()} onPress={() => void uninstall(row.name, true)}>
                      Delete its data
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy()} onPress={() => setRemoving(null)}>
                      Cancel
                    </Button>
                  </Show>
                </Show>
              </span>
            </li>
          )}
        </For>
      </ul>

      <ReplacedSurfaces />
      <ExtensionPointsDev />
    </div>
  )
}

// The exclusive-slot picker (registries/exclusiveSlots.ts, docs/plugins.md § Replacing a core
// surface). Lives here rather than in Appearance, and hides when nobody has offered a replacement.
function ReplacedSurfaces() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const stored = () => prefs.data?.[PrefKeys.exclusiveSlots]
  const choice = (slot: CoreExclusiveSlot) => exclusiveSlotChoices(stored())[slot] ?? CORE_SLOT_PROVIDER
  const rows = () =>
    CORE_EXCLUSIVE_SLOTS.map((slot) => ({ slot, offers: exclusiveSlotOffers(slot) })).filter((row) => row.offers.length)

  return (
    <Show when={rows().length}>
      {/* A plain div rather than a nested `.settings-section`: this page's root already is one. */}
      <div>
        <p class="muted">
          Some plugins offer to draw one of acorn's own surfaces. Nothing is replaced until you pick it
          here, and acorn draws its own again if that plugin is turned off or its surface fails.
        </p>
        <For each={rows()}>
          {(row) => (
            <Field label={CORE_SLOT_LABEL[row.slot]}>
              <Select
                value={choice(row.slot)}
                options={[
                  { value: CORE_SLOT_PROVIDER, label: "acorn's own" },
                  ...row.offers.map((offer) => ({ value: offer.pluginId, label: `${offer.label} (${offer.pluginId})` })),
                ]}
                onChange={(value) => void savePref(qc, PrefKeys.exclusiveSlots, withExclusiveSlotChoice(stored(), row.slot, value))}
              />
              {/* A replacement that fell back is the one case where the setting and the screen
                  disagree, and the owner has no other way to find out why. */}
              <Show when={choice(row.slot) !== CORE_SLOT_PROVIDER && exclusiveSlotFailed(row.slot, choice(row.slot))}>
                <span class="plugin-failed" role="status">that surface failed — acorn's own is showing</span>
              </Show>
            </Field>
          )}
        </For>
      </div>
    </Show>
  )
}

// Core's own name for each designated surface, because the label says which of acorn's surfaces is
// being replaced. The plugin's own label is already the option text.
const CORE_SLOT_LABEL: Record<CoreExclusiveSlot, string> = { 'rail.taskList': 'Task list in the rail' }
