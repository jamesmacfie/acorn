import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import type { NodePluginRow, NodePluginState, PluginInstallSource } from '@acorn/protocol/api.ts'
import { sendReferenceToAgent } from '../../agent/reference'
import { nodes } from '../../../infra/node/fleet'
import { restartLocalNode } from '../../../infra/node/fleetActions'
import { installNodePlugin, refreshNodePlugins } from '../../../infra/node/nodePlugins'
import { installPluginOnDevice, readPluginHostState } from '../../../host/plugins/host'
import { devicePlugins, distribution, reviewPendingTrust, syncPluginDistribution } from '../../../host/plugins/distribution'
import { awaitingInputApproval } from '../../../host/plugins/distributionModel'
import { reconcileDevicePluginChange } from '../../../host/plugins/reload'
import type { SettingsPageContext } from '../../../host/registries/shell/settings'
import { Alert, Badge, Button, SegmentedControl } from '../../../kit/components/primitives'
import { Inline } from '../../../kit/components/layout/Inline'
import { Text } from '../../../kit/components/content/Text'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { activeTaskId } from '../../tasks/tasks'
import ConfigPluginOffers from './ConfigPluginOffers'
import { InstallPlugin, type InstallTarget } from './InstallPlugin'
import {
  installedPlugins, matchesFilter, pluginName, pluginOrigin, statusBadgeTone, statusDetail, statusOf, statusWord, takePluginRequest, type InstalledFilter, type InstalledPlugin,
} from './installed'
import { PluginPage } from './PluginPage'
import type { PluginStatus } from '../../../host/plugins/pluginStatus'
import './plugins.css'

// Settings > Plugins > Installed: every plugin the node in the header runs and every client-only plugin
// this device holds, then one plugin's own page in the same pane (docs/plugins/activation.md § What the
// owner sees). Per node, because a fleet is a set of independently administered nodes, and the node is
// the one the header's switcher names.
//
// Each node row carries two facts: `disabled`, what happens at the node's next start, and `running`, what
// is happening now. They diverge between saving and restarting, and this page is where the owner sees
// the difference: in each row's status and in the restart banner above the list.

// The seeded prompt behind "Create a plugin" (docs/plugins/agent-install.md § Teaching the agent). The teaching
// lives in the `plugin_authoring` tool this text names, not in the text; that tool's test asserts
// this file still names it.
export const PLUGIN_STARTER_PROMPT = `I want to extend acorn with a plugin.

Call the \`plugin_authoring\` tool first. It returns the authoring contract and this node's own manifest
vocabulary, and an answer from memory will be wrong. Then write the package and ask me for it with
\`plugin_request\` using \`dev: true\`, so I approve once and you can iterate.

What it should do: `

// The origin starts the line when there is no version ("Built in. Active."), so the line takes a capital.
const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
const stop = (text: string): string => (/[.!?…]$/.test(text) ? text : `${text}.`)
/** A row's line: its version and where it came from, then the status sentence when the badge's word
 *  leaves something out. */
const rowText = (entry: { plugin: InstalledPlugin; status: PluginStatus }): string => {
  const version = entry.plugin.kind === 'node' && entry.plugin.row.installed?.version ? `Version ${entry.plugin.row.installed.version}, ` : ''
  const detail = statusDetail(entry.status)
  return sentence(`${version}${pluginOrigin(entry.plugin)}.${detail ? ` ${stop(detail)}` : ''}`)
}

type Open = { kind: 'install' } | { kind: 'plugin'; id: string; pluginKind?: InstalledPlugin['kind'] }

export default function PluginsSettings(props: { context: SettingsPageContext }) {
  const nodeId = () => props.context.scope.nodeId
  const node = () => nodes().find((candidate) => candidate.nodeId === nodeId()) ?? null
  const nodeLabel = () => node()?.label ?? 'this node'
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [filter, setFilter] = createSignal<InstalledFilter>('all')
  const [open, setOpen] = createSignal<Open>()

  // Each answer carries the node it came from. While the switcher's new node is being read, Solid still
  // hands back the old node's answer, and a row from it would put that node's plugins under this header,
  // or send this node a disabled list built from the other's plugins.
  const [read, { mutate, refetch }] = createResource<{ nodeId: string; state: NodePluginState | null }, string>(
    () => nodeId() ?? '',
    async (id) => ({ nodeId: id, state: id ? await refreshNodePlugins(id) : null }),
  )
  const state = () => {
    const answer = read()
    return answer?.nodeId === (nodeId() ?? '') ? answer.state : undefined
  }
  const reading = () => state() === undefined
  const rows = createMemo<NodePluginRow[]>(() => state()?.plugins ?? [])
  // The device's own answers, which the node knows nothing about: it served the bundle, and this machine
  // accepted it, declined it, or put the plugin into development mode (docs/security/plugin-install.md § The dev grant).
  const [custody, { refetch: refetchCustody }] = createResource(async () => await readPluginHostState())

  const plugins = createMemo(() => installedPlugins(rows(), devicePlugins()))
  const devMode = (plugin: InstalledPlugin) => (custody()?.devGrants ?? []).some((grant) => grant.pluginId === plugin.id
    && (plugin.kind === 'device' ? grant.source?.kind === 'device' : grant.nodeId === nodeId()))
  const listed = createMemo(() => plugins().map((plugin) => ({ plugin, status: statusOf(distribution(), nodeId(), plugin, devMode(plugin)) })))
  const shown = () => listed().filter((entry) => matchesFilter(filter(), entry.plugin, entry.status))
  const count = (which: InstalledFilter) => listed().filter((entry) => matchesFilter(which, entry.plugin, entry.status)).length

  // Manage plugin, from a plugin's strip or a tool's owner, lands here (./installed.ts § openPluginPage).
  createEffect(() => {
    const asked = takePluginRequest()
    if (!asked) return
    setOpen({ kind: 'plugin', id: asked.id, ...(asked.kind ? { pluginKind: asked.kind } : {}) })
  })
  const openPlugin = createMemo((): InstalledPlugin | undefined => {
    const current = open()
    if (current?.kind !== 'plugin') return undefined
    return plugins().find((plugin) => plugin.id === current.id && (!current.pluginKind || plugin.kind === current.pluginKind))
  })

  // A plugin waiting to have what it reads approved opens that dialog, which is the one decision left.
  const manage = (plugin: InstalledPlugin) => {
    if (plugin.kind === 'node' && awaitingInputApproval(plugin.row)) reviewPendingTrust(plugin.id)
    else setOpen({ kind: 'plugin', id: plugin.id, pluginKind: plugin.kind })
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

  // The node has the package; this device has not seen its bytes (docs/security/plugin-bundles.md § Third-party plugin
  // bundles). Fetching and hashing them here queues the trust prompt, so an install walks straight into
  // consent instead of waiting for the next launch to ask.
  const settleNode = async () => {
    await refetch()
    await syncPluginDistribution()
  }
  const settleDevice = async () => {
    await reconcileDevicePluginChange()
    await refetchCustody()
  }
  const install = async (target: InstallTarget, source: PluginInstallSource) => {
    if (target === 'device') {
      await installPluginOnDevice(source)
      await settleDevice()
      return
    }
    await installNodePlugin(source, {}, nodeId() ?? undefined)
    await settleNode()
  }

  const restart = () => run(async () => {
    await restartLocalNode()
    // The shell reloads the renderer after a successful restart, so this refetch only matters when that
    // did not happen and the list still needs a re-read.
    await refetch()
  })

  // The agent writes the package; the owner still installs it (docs/plugins/agent-install.md § Approval-mediated
  // install). This button reaches an agent, never the install route. It lands a draft in the task's
  // composer rather than starting a turn, because a settings button that silently starts an agent turn
  // is one nobody presses twice.
  const createPlugin = () => run(async () => {
    const taskId = activeTaskId()
    if (!taskId) throw new Error('Open a task first. The prompt goes to that task’s agent.')
    const result = await sendReferenceToAgent(taskId, PLUGIN_STARTER_PROMPT)
    if (!result.ok) throw new Error(result.reason ?? 'That task has no agent session to send to.')
  })

  const list = () => (
    <>
      <Show when={error()}><Alert>{error()}</Alert></Show>
      <Show when={state()?.restartRequired}>
        <Alert
          tone="warn"
          variant="banner"
          actions={
            <Show when={node()?.local} fallback={<Text emphasis="muted">Restart it on its own machine to apply the change.</Text>}>
              <Button size="sm" disabled={busy()} onPress={() => void restart()}>Restart node</Button>
            </Show>
          }
        >
          {nodeLabel()} is still running the plugins it started with.
        </Alert>
      </Show>
      <ConfigPluginOffers busy={busy()} onInstall={(id, source) => void run(async () => {
        await installPluginOnDevice(source, id)
        await settleDevice()
      })} />

      {/* No browse-and-discover surface, because any listing acorn could offer would be unreviewed
          (docs/extensibility.md § Some decisions that look like gaps). */}
      <SettingsSection
        id="installed"
        label="Installed plugins"
        actions={
          <>
            <SegmentedControl
              size="sm"
              ariaLabel="Show"
              value={filter()}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'needs-you', label: `Needs you${count('needs-you') ? ` (${count('needs-you')})` : ''}` },
                { value: 'device', label: `This device${count('device') ? ` (${count('device')})` : ''}` },
              ]}
            />
            <Button size="sm" onPress={() => setOpen({ kind: 'install' })}>Install…</Button>
          </>
        }
      >
        <Show when={reading()}><Text emphasis="muted">Reading the plugin list…</Text></Show>
        {/* A node that cannot answer is not an empty list; rendering nothing would read as one. */}
        <Show when={!reading() && !rows().length}>
          <Text emphasis="muted">{nodeLabel()} didn't send its plugin list. It may be offline.</Text>
        </Show>
        <For
          each={shown()}
          fallback={<Show when={rows().length || devicePlugins().length}><Text emphasis="muted">{filter() === 'needs-you' ? 'Nothing needs you.' : 'No plugins on this device.'}</Text></Show>}
        >
          {(entry) => (
            <SettingRow label={pluginName(entry.plugin)} description={rowText(entry)}>
              <Inline>
                <Badge tone={statusBadgeTone(entry.status)}>{statusWord(entry.status)}</Badge>
                <Button size="sm" variant="ghost" label={`Manage ${pluginName(entry.plugin)}`} onPress={() => manage(entry.plugin)}>
                  Manage
                </Button>
              </Inline>
            </SettingRow>
          )}
        </For>
      </SettingsSection>

      <SettingsSection id="create" label="Create a plugin">
        <SettingRow
          label="Ask an agent to write one"
          description="Starts a prompt in the open task's agent. It writes the plugin, and you decide whether to install it."
        >
          <Button size="sm" disabled={busy()} onPress={() => void createPlugin()}>Ask an agent</Button>
        </SettingRow>
      </SettingsSection>
    </>
  )

  return (
    <Show
      when={open()?.kind === 'install'}
      fallback={
        <Show when={openPlugin()} fallback={list()}>
          {(plugin) => (
            <PluginPage
              plugin={plugin()}
              nodeId={nodeId()}
              rows={rows()}
              custody={custody()}
              navigate={props.context.navigate}
              onBack={() => setOpen(undefined)}
              settleNode={settleNode}
              settleDevice={settleDevice}
              onNodeState={(next, forNode) => {
                // An answer from a node the header has since left would stand in for the new node's read.
                if (forNode === (nodeId() ?? '')) mutate({ nodeId: forNode, state: next })
              }}
            />
          )}
        </Show>
      }
    >
      <InstallPlugin nodeLabel={nodeLabel()} nodeIsLocal={node()?.local === true} install={install} onClose={() => setOpen(undefined)} />
    </Show>
  )
}
