import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { NodePluginRow, NodePluginState, PluginInstallSource } from '@acorn/protocol/api.ts'
import { sendReferenceToAgent } from '../agent/reference'
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
import { canPickFolder, pickFolder } from '../platform'
import { readPluginHostState, setPluginDevGrant } from '../plugins/host'
import { syncPluginDistribution } from '../plugins/distribution'
import { Alert, Button, Checkbox, Field, Input, Select } from '../ui/primitives'
import { activeTaskId } from '../tasks/tasks'
import { nextDisabledList, pluginPending } from './pluginToggle'
import { CORE_EXCLUSIVE_SLOTS } from '@acorn/protocol/extensionPoints.ts'
import { prefsOptions } from '../queries'
import { PrefKeys } from '../persistence/prefKeys'
import { savePref } from './savePref'
import {
  CORE_SLOT_PROVIDER,
  exclusiveSlotChoices,
  exclusiveSlotFailed,
  exclusiveSlotOffers,
  withExclusiveSlotChoice,
  type CoreExclusiveSlot,
} from '../registries/exclusiveSlots'
import './settings.css'

// Settings → Plugins (docs/ui-design.md § New surfaces: "the list of plugins with enable/disable toggles
// (per node)"), and since phase 5 the whole install lifecycle as well
// (docs/plugins.md).
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

// The seeded prompt behind "Create a plugin". Two sentences of process and one blank line for the owner
// to finish the thought in, which is all bb's equivalent is — the teaching is not in this text, it is in
// the `plugin_authoring` tool this text tells the agent to call (node-core/server/agentTools/
// pluginAuthoring.ts, whose test asserts this file still names it).
//
// Scoped down, deliberately, and worth being plain about: this does NOT open a new task. `TaskSeed` has
// no prompt field and Settings has no project in scope, so "open a task with this prompt" would mean a
// protocol field, a column and a create-modal seed path — new plumbing for an entry point. What exists
// already is `sendReferenceToAgent`, the "drop this text into the task's agent composer as a draft" seam
// the editor and changes panes use, and it degrades honestly when there is no session to drop into.
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

  // The device's own answers, which the node knows nothing about: it served the bundle, and this
  // machine declined to run it — or put it into development mode (plugins/distribution.ts,
  // docs/security.md § The dev grant). Refetched after the one control on this page that changes them.
  const [custody, { refetch: refetchCustody }] = createResource(async () => await readPluginHostState())
  const blockedHere = (row: NodePluginRow): boolean => {
    const hash = row.installed?.client?.hash
    return !!hash && (custody()?.acks ?? []).some((ack) => ack.pluginId === row.name && ack.hash === hash && ack.decision === 'rejected')
  }
  // A plugin in development on THIS device, against THIS node. Both halves matter: the same plugin may be
  // a plain install on the owner's other laptop, and a bundle offered under this name by a different node
  // is not covered by the grant.
  const devGrant = (row: NodePluginRow) =>
    (custody()?.devGrants ?? []).find((grant) => grant.pluginId === row.name && grant.nodeId === nodeId())

  // Ending development mode is one act with two halves (main/pluginTrustStore.ts): the grant goes, and so
  // does every bundle it auto-trusted. What is left is whatever the owner answered by hand, so the current
  // bundle is undecided again and the normal per-hash prompt asks about it on the next distribution pass —
  // which is exactly what promoting a plugin to a normal install has to mean.
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

  // The agent writes the package; the owner still installs it. So this button reaches an agent, never the
  // install route — the whole point of the approval split is that nothing on the agent's side of it can
  // put code on the node.
  const createPlugin = () =>
    run(async () => {
      const taskId = activeTaskId()
      if (!taskId) throw new Error('Open a task first — the prompt is delivered to that task’s agent.')
      const result = await sendReferenceToAgent(taskId, PLUGIN_STARTER_PROMPT)
      if (!result.ok) throw new Error(result.reason ?? 'That task has no agent session to send to.')
    })

  // Offered only for a LOCAL node, and that is not a polish detail: the dialog browses this device's
  // filesystem and the path is resolved by the node, so picking a folder for a remote node would hand it
  // an absolute path that means something else there, or nothing at all. Remote nodes keep the text
  // field, where the owner is typing a path on the remote machine and knows it.
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

  // No background checking and no "an update is available" badge: re-resolving every source on every
  // roster read would mean this page phones GitHub for each installed plugin, and an update is the one
  // moment a compromised maintainer gets to run new code (docs/security.md § Supply
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
        <Alert
          tone="warn"
          variant="banner"
          actions={
            <Show when={node()?.local} fallback={<span class="muted">Restart it on its own machine to apply the change.</span>}>
              <Button size="sm" disabled={busy()} onClick={() => void restart()}>Restart node</Button>
            </Show>
          }
        >
          This node is still running the previous set of plugins.
        </Alert>
      </Show>

      <Show when={error()}><Alert>{error()}</Alert></Show>

      {/* The other way a plugin gets here: the agent writes one. It lands as a DRAFT in the task's agent
          composer — the owner reads it, finishes the sentence and sends — because a settings button that
          silently starts an agent turn is a button nobody presses twice. */}
      <div class="plugin-authoring">
        <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void createPlugin()}>
          Create a plugin
        </Button>
        <span class="muted">
          Drafts a prompt in the current task's agent. It writes the package and asks you to install it;
          it cannot install anything itself.
        </span>
      </div>

      {/* The install form. Deliberately plain: there is no browse-and-discover surface and there is not
          going to be one soon, because any listing acorn could offer would be unreviewed
          (docs/plugins.md § Non-goals). Someone who installs a plugin here already decided to
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
        <Show when={canBrowse()}>
          <Button type="button" variant="ghost" disabled={busy()} onClick={() => void browse()}>Choose…</Button>
        </Show>
        <Button type="submit" disabled={busy() || !spec().trim()}>Install</Button>
      </form>
      <p class="muted plugin-install-hint">
        A plugin's server code runs with the same access as acorn itself. This device asks again, showing
        what the plugin declared, before any of its interface code runs here.
      </p>
      {/* Said only for the source it is true of. A folder is symlinked, not copied, so it is the one
          install whose bytes keep changing after the fact — the owner should know that before they point
          acorn at a directory something else writes to (docs/security.md § Installing from a folder). */}
      <Show when={kind() === 'path'}>
        <p class="muted plugin-install-hint">
          A folder is linked, not copied: whatever is in it when the node next starts is what runs, and
          acorn cannot pin those bytes the way it pins a downloaded package.
        </p>
      </Show>

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
              <Checkbox
                label={<span class="plugin-name">{row.name}</span>}
                checked={!row.disabled}
                disabled={busy()}
                onChange={(event) => void toggle(row.name, !event.currentTarget.checked)}
              />
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
              {/* Development mode, stated in full rather than as a decoration. The security story here
                  rests entirely on the owner being able to SEE this and end it: the moment a dev-mode
                  plugin looks like a normal install, the trust story has rotted (docs/security.md § The
                  dev grant). */}
              <Show when={devGrant(row)}>
                {(grant) => (
                  <>
                    <span class="plugin-dev" role="status" title={grant().path}>
                      in development — bundle changes are auto-trusted
                    </span>
                    <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void endDevMode(row)}>
                      End dev mode
                    </Button>
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
              {/* A plugin installed on this node that threw, or that never loaded at all. Restarting will
                  not fix either, so this deliberately does not raise the restart banner — the owner has to
                  turn it off or fix the plugin.

                  `reason` is the node's verbatim account of what broke: a thrown message from a contained
                  init, or the loader's own sentence for a manifest that does not parse or a bundle that
                  will not import. It is a loaded plugin's text crossing into the owner's UI, so it is
                  interpolated as TEXT and arrives already capped from the node. Absent from an older
                  node, which is why the label stands alone. */}
              <Show when={row.state === 'failed'}>
                <span class="plugin-failed" role="status">
                  failed to {row.stage === 'load' ? 'load' : 'start'}
                </span>
                <Show when={row.reason}>
                  {(reason) => <span class="plugin-failed-reason muted" title={reason()}>{reason()}</span>}
                </Show>
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

      <ReplacedSurfaces />
    </div>
  )
}

// The arbitration for the exclusive slots (registries/exclusiveSlots.ts).
//
// HERE rather than in Appearance, and the difference is what the choice is ABOUT. Appearance is two axes
// the app owns — colour and shape — and every option in it exists whether or not anything is installed.
// This picker has options only because packages are installed, its options are named after them, and the
// person who wants to change it back is a person looking for the plugin that did it. That is this page.
//
// Hidden entirely when nobody has offered, because a select with one option is a control that cannot do
// anything, and a permanent row saying "no plugin replaces your task list" is chrome earning nothing.
function ReplacedSurfaces() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const stored = () => prefs.data?.[PrefKeys.exclusiveSlots]
  const choice = (slot: CoreExclusiveSlot) => exclusiveSlotChoices(stored())[slot] ?? CORE_SLOT_PROVIDER
  const rows = () =>
    CORE_EXCLUSIVE_SLOTS.map((slot) => ({ slot, offers: exclusiveSlotOffers(slot) })).filter((row) => row.offers.length)

  return (
    <Show when={rows().length}>
      {/* A plain div rather than a nested `.settings-section`: this page's root already is one, and the
          rows below are fields, not a second page. */}
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
                onChange={(event) =>
                  void savePref(qc, PrefKeys.exclusiveSlots, withExclusiveSlotChoice(stored(), row.slot, event.currentTarget.value))}
              >
                <option value={CORE_SLOT_PROVIDER}>acorn's own</option>
                <For each={row.offers}>
                  {(offer) => <option value={offer.pluginId}>{offer.label} ({offer.pluginId})</option>}
                </For>
              </Select>
              {/* Stated rather than hidden. A replacement that fell back is the one situation where the
                  setting and the screen disagree, and an owner staring at their old task list with this
                  select still naming a plugin has no other way to find out why. */}
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

// Core's own name for each designated surface. Core's, not the plugin's: the label beside the picker has
// to say which of ACORN's surfaces is being replaced, and a plugin's own label is already the option text.
const CORE_SLOT_LABEL: Record<CoreExclusiveSlot, string> = { 'rail.taskList': 'Task list in the rail' }
