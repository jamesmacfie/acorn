import { createMemo, createSignal, For, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import type { NodePluginRow, NodePluginState } from '@acorn/protocol/api.ts'
import { reviewNodePlugin, uninstallNodePlugin, updateNodePlugin } from '../../../infra/node/nodePlugins'
import type { PluginHostState } from '../../../infra/platform'
import { forgetPluginTrust, installPluginOnDevice, setPluginDevGrant } from '../../../host/plugins/host'
import { distribution, refreshPluginTrust, resolvePendingTrust } from '../../../host/plugins/distribution'
import {
  agentToolGrants, agentToolPermissionLines, navigationDestinationGrants, navigationDestinationPermissionLines, nodePermissionLines,
  scheduleGrants, schedulePermissionLines, uiPermissionLines, webviewGrants, webviewPermissionLines,
} from '../../../host/trust/permissions'
import { confirmAction } from '../../../host/registries/shell/willPhase'
import { isStandaloneSettingsPage, settingsCategoryOf, settingsRegistry, settingsScopeOf, SETTINGS_CATEGORY_LABELS, type SettingsNavigate } from '../../../host/registries/shell/settings'
import { activeNodeId } from '../../../infra/node/activeNode'
import { commandRegistry } from '../../../host/registries/commands/commands'
import { keybindingRegistry } from '../../../host/registries/commands/keybindings'
import { exclusiveSlotOffers } from '../../../host/registries/extensionPoints/exclusiveSlots'
import { CORE_EXCLUSIVE_SLOTS } from '@acorn/protocol/extensionPoints.ts'
import { Alert, Badge, Button, Checkbox } from '../../../kit/components/primitives'
import { Facts } from '../../../kit/components/content/Facts'
import { Text } from '../../../kit/components/content/Text'
import { Inline } from '../../../kit/components/layout/Inline'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { Stack } from '../../../kit/components/layout/Stack'
import { TabPanel, Tabs } from '../../../kit/components/layout/Tabs'
import { createRailVisibility, pluginSources } from '../../tabs/railVisibility'
import { useSettingsDetail } from '../settingsDetail'
import { createSettingSave } from '../settingSave'
import { pluginName, pluginRow, statusOf, type InstalledPlugin } from './installed'
import { removeDevicePlugin, setDevicePluginEnabled, setNodePluginEnabled } from './pluginActions'
import './plugins.css'

// One plugin's page under Settings > Plugins > Installed (docs/plugins/activation.md § What the owner
// sees). What used to be crammed into one row of the list, spread over three tabs: whether it is on and
// what it adds (its settings pages among them), what it may do and what this device decided about it,
// and which version runs.
// Uninstalling sits in the danger zone under them, where the shell's one confirmation names what goes.

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'versions', label: 'Versions' },
] as const
type Tab = (typeof TABS)[number]['id']
const ID_PREFIX = 'plugin-page'

export type PluginPageProps = {
  plugin: InstalledPlugin
  /** The node the list reads, the header's switcher. A device plugin ignores it. */
  nodeId: string | null
  /** Every row the node reports, for the disabled list the toggle recomputes. */
  rows: readonly NodePluginRow[]
  /** This device's own answers about plugin bundles: approvals and dev grants. */
  custody: PluginHostState | undefined
  navigate: SettingsNavigate
  onBack: () => void
  /** Re-read the node's list after a change the node made, and let the device fetch any new bundle. */
  settleNode: () => Promise<void>
  /** Reconcile this device's plugins after a device change, and re-read its answers. */
  settleDevice: () => Promise<void>
  /** The node's answer to a write, with the node it was sent to, which the header may have left since. */
  onNodeState: (state: NodePluginState, nodeId: string) => void
}

export function PluginPage(props: PluginPageProps) {
  const qc = useQueryClient()
  const [tab, setTab] = createSignal<Tab>('overview')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const hostDrawsBack = useSettingsDetail(() => pluginName(props.plugin), props.onBack)
  const row = () => pluginRow(props.plugin)
  const nodeRow = () => (props.plugin.kind === 'node' ? props.plugin.row : undefined)

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

  // Development mode is this device's answer and names one node, because the same plugin may be a plain
  // install on the owner's other laptop (docs/security/plugin-install.md § The dev grant).
  const devGrant = () => (props.custody?.devGrants ?? []).find((grant) => grant.pluginId === props.plugin.id
    && (props.plugin.kind === 'device' ? grant.source?.kind === 'device' : grant.nodeId === props.nodeId))
  const status = createMemo(() => statusOf(distribution(), props.nodeId, props.plugin, !!devGrant()))

  const enableSave = createSettingSave()
  const togglable = () => props.plugin.kind === 'device' || !row().required
  const setEnabled = (on: boolean) => enableSave.run(async () => {
    if (props.plugin.kind === 'device') {
      await setDevicePluginEnabled(qc, props.plugin.id, on)
      await props.settleDevice()
      return
    }
    const nodeId = props.nodeId ?? ''
    props.onNodeState(await setNodePluginEnabled(props.rows, props.plugin.id, on, nodeId || undefined), nodeId)
  })

  // Overview and Settings read what the plugin registered in this window, which runs on the active node.
  // With the header on another node they say so, rather than passing that node's plugin off as this one.
  const elsewhere = () => props.plugin.kind === 'node' && props.nodeId !== activeNodeId()

  return (
    <>
      <Show when={!hostDrawsBack}>
        <Inline><Button variant="bare" size="sm" onPress={props.onBack}>‹ Installed</Button></Inline>
      </Show>
      <Show when={error()}><Alert>{error()}</Alert></Show>

      <Tabs tabs={TABS} active={tab()} onChange={(id) => setTab(id as Tab)} idPrefix={ID_PREFIX} ariaLabel={`About ${pluginName(props.plugin)}`} />
      <TabPanel idPrefix={ID_PREFIX} id="overview" active={tab()}>
        <Stack gap="section">
          <SettingsSection id="plugin" label="Status">
            <SettingRow label="Enabled" description={props.plugin.kind === 'node' ? 'Takes effect when the node next starts.' : 'Applies right away on this computer.'} error={enableSave.error()}>
              <Show when={togglable()} fallback={<Text emphasis="muted">Required. acorn needs it to run.</Text>}>
                <Checkbox switch ariaLabel={`Enable ${pluginName(props.plugin)}`} checked={!row().disabled} disabled={busy()} onChange={setEnabled} />
              </Show>
            </SettingRow>
            <Show when={status().tone !== 'ok'}>
              <Alert
                tone={status().tone === 'danger' ? 'danger' : status().needsYou ? 'warn' : 'muted'}
                variant="banner"
                actions={status().line === 'waiting' ? <Button size="sm" onPress={() => setTab('permissions')}>Review…</Button> : undefined}
              >
                {status().text}
              </Alert>
            </Show>
          </SettingsSection>
          <Overview plugin={props.plugin} navigate={props.navigate} elsewhere={elsewhere()} />
        </Stack>
      </TabPanel>
      <TabPanel idPrefix={ID_PREFIX} id="permissions" active={tab()}>
        <Stack gap="section">
          <Permissions {...props} busy={busy()} run={run} devGrant={devGrant()} />
        </Stack>
      </TabPanel>
      <TabPanel idPrefix={ID_PREFIX} id="versions" active={tab()}>
        <Stack gap="section"><Versions {...props} busy={busy()} run={run} /></Stack>
      </TabPanel>

      <DangerZone {...props} busy={busy()} run={run} nodeRow={nodeRow()} />
    </>
  )
}

type Actions = { busy: boolean; run: (work: () => Promise<void>) => Promise<void> }

const ELSEWHERE = 'This shows what the plugin adds on the node this window uses, not the one in the header. To see the other, switch the window to that node.'

// What the plugin put into acorn, each linking to where it is changed: rail sources, its settings pages,
// surfaces it offers to draw, commands, agent tools, and events. Read from the registries the plugin
// registered into, so it says what is on this device now rather than what a manifest promised.
function Overview(props: { plugin: InstalledPlugin; navigate: SettingsNavigate; elsewhere: boolean }) {
  const visibility = createRailVisibility()
  // One per source, so a failed switch is said on its own row only.
  const railSaves = new Map<string, ReturnType<typeof createSettingSave>>()
  const railSave = (id: string) => {
    let save = railSaves.get(id)
    if (!save) railSaves.set(id, save = createSettingSave())
    return save
  }
  const sources = () => pluginSources(props.plugin.id).map(({ pluginId, source }) => ({ pluginId, ...source }))
  const commands = () => commandRegistry.entries().filter((command) => command.ownerId === props.plugin.id && command.palette)
  const shortcuts = () => keybindingRegistry.entries().filter((binding) => keybindingRegistry.ownerOf(binding.id) === props.plugin.id)
  const contributions = () => pluginRow(props.plugin).active?.contributions ?? pluginRow(props.plugin).installed?.contributions
  const tools = () => {
    const declared = contributions()
    return declared ? agentToolGrants(declared).length : 0
  }
  const emits = () => pluginRow(props.plugin).emits ?? []
  const pages = () => settingsRegistry.entries().filter((page) => settingsRegistry.ownerOf(page.id) === props.plugin.id)
  const surfaces = () => CORE_EXCLUSIVE_SLOTS.flatMap((slot) => exclusiveSlotOffers(slot).filter((offer) => offer.pluginId === props.plugin.id))
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

  return (
    <SettingsSection id="adds" label="What it adds" description={props.elsewhere ? ELSEWHERE : undefined}>
      <For each={sources()}>
        {(source) => (
          <SettingRow
            label={`Rail source: ${source.label}`}
            description={source.showInRailByDefault === false && !visibility.shown(source.id) ? 'Hidden until you show it.' : undefined}
            error={railSave(source.id).error()}
          >
            <Checkbox
              switch
              ariaLabel={`Show ${source.label} in left rail`}
              checked={visibility.shown(source.id)}
              onChange={(on) => railSave(source.id).run(() => visibility.setShown(source.pluginId, source.id, on, { throwOnFailure: true }))}
            />
          </SettingRow>
        )}
      </For>
      {/* A workspace or project page is a tab on each workspace's or project's own page, not a page of
          its own to open. */}
      <For each={pages()}>
        {(page) => (
          <Show
            when={isStandaloneSettingsPage(page)}
            fallback={<SettingRow label={page.title ?? page.label} description={`A tab on each ${settingsScopeOf(page)}'s settings page.`} />}
          >
            <SettingRow label={page.title ?? page.label} description={`Settings page in ${SETTINGS_CATEGORY_LABELS[settingsCategoryOf(page)]}.`}>
              <Button size="sm" variant="ghost" onPress={() => props.navigate(page.id)}>Open</Button>
            </SettingRow>
          </Show>
        )}
      </For>
      <Show when={surfaces().length}>
        <SettingRow label="Replaced surfaces" description={`Can replace acorn's ${surfaces().map((offer) => offer.label).join(', ')}.`}>
          <Button size="sm" variant="ghost" onPress={() => props.navigate('rail-surfaces#surfaces')}>Rail and surfaces</Button>
        </SettingRow>
      </Show>
      <Show when={commands().length || shortcuts().length}>
        <SettingRow label="Commands and shortcuts" description={`${plural(commands().length, 'command')}, ${plural(shortcuts().length, 'shortcut')}.`}>
          <Button variant="ghost" size="sm" onPress={() => props.navigate('shortcuts')}>Keyboard shortcuts</Button>
        </SettingRow>
      </Show>
      <Show when={tools()}>
        <SettingRow label="Agent tools" description={plural(tools(), 'agent tool')}>
          <Button variant="ghost" size="sm" onPress={() => props.navigate('agent-tools')}>Tools and permissions</Button>
        </SettingRow>
      </Show>
      <Show when={emits().length}>
        <SettingRow label="Events it announces" help="Other plugins can react to these." layout="stacked">
          <ul class="plugin-emits">
            <For each={emits()}>{(event) => <li><code>{event.verb}</code><span>{event.description}</span></li>}</For>
          </ul>
        </SettingRow>
      </Show>
      <Show when={!sources().length && !pages().length && !surfaces().length && !commands().length && !shortcuts().length && !tools() && !emits().length}>
        <Text emphasis="muted" wrap>It isn't adding anything right now. A plugin that's off or waiting for approval adds nothing.</Text>
      </Show>
    </SettingsSection>
  )
}

// What the plugin may do, and every answer this device gave about it. The controls docs/security.md asks
// the owner to be able to see and end, so they get a tab rather than a line of small buttons.
function Permissions(props: PluginPageProps & Actions & { devGrant: PluginHostState['devGrants'][number] | undefined }) {
  const row = () => pluginRow(props.plugin)
  const pending = () => (props.plugin.kind === 'node' ? props.plugin.row.pendingReview : undefined)
  const lines = () => {
    const declared = row().installed
    if (!declared) return []
    return [
      ...nodePermissionLines(declared.permissions),
      ...schedulePermissionLines(scheduleGrants(declared.contributions)),
      ...uiPermissionLines(declared.permissions, row().name),
      ...navigationDestinationPermissionLines(navigationDestinationGrants(declared.contributions)),
      ...webviewPermissionLines(webviewGrants(declared.contributions)),
      ...agentToolPermissionLines(agentToolGrants(declared.contributions)),
    ]
  }
  // Approvals for the bytes this node offers now, running or waiting on disk. A built-in's bundle ships in
  // the app and asks nobody.
  const decisions = () => {
    const plugin = props.plugin
    if (plugin.kind === 'device') return (props.custody?.acks ?? []).filter((ack) => ack.pluginId === row().name && ack.hash === plugin.entry.hash)
    const hashes = new Set([row().active?.client?.hash, row().installed?.client?.hash].filter((hash): hash is string => !!hash))
    return row().installed?.bundled ? [] : (props.custody?.acks ?? []).filter((ack) => ack.pluginId === row().name && hashes.has(ack.hash))
  }
  const forget = (hash: string, deferred: boolean) => props.run(async () => {
    await forgetPluginTrust({ pluginId: row().name, hash })
    if (deferred) resolvePendingTrust(row().name, hash)
    await refreshPluginTrust()
    await props.settleDevice()
  })
  // Ending development mode drops the grant and every approval it wrote, so the plugin goes back to
  // being asked about each bundle, starting with the current one.
  const setDevMode = (grant: boolean) => props.run(async () => {
    await setPluginDevGrant(props.plugin.kind === 'device'
      ? { pluginId: row().name, nodeId: '', source: { kind: 'device' }, grant }
      : { pluginId: row().name, nodeId: props.nodeId ?? '', grant })
    await refreshPluginTrust()
    await props.settleDevice()
  })
  const decideStaged = (decision: 'approved' | 'denied') => props.run(async () => {
    const review = pending()
    if (!review || !('reviewId' in review)) throw new Error('This review record is unreadable. Remove the package to clear it.')
    if (decision === 'approved' && !row().installed) throw new Error('The staged package is missing. Remove this interrupted review.')
    await reviewNodePlugin(row().name, review, decision, props.nodeId ?? undefined)
    await props.settleNode()
  })

  return (
    <>
      <Show when={pending()}>
        {(review) => (
          <SettingsSection id="review" label="Waiting for your review">
            <Show when={!('corrupt' in review())} fallback={<Alert>Review record is unreadable. Remove this package to recover.</Alert>}>
              <Text>
                An agent asked for {row().name} {row().installed?.version}, and it is held from running. Its node code cannot start
                until you approve it. If the install was interrupted, remove it and ask the agent to try again.
              </Text>
              <Inline>
                <Button size="sm" disabled={props.busy || !row().installed} onPress={() => void decideStaged('approved')}>Approve this package</Button>
                <Button size="sm" tone="danger" disabled={props.busy} onPress={() => void decideStaged('denied')}>Remove staged package</Button>
              </Inline>
            </Show>
          </SettingsSection>
        )}
      </Show>
      <SettingsSection id="grants" label="What it may do">
        <For each={lines()} fallback={<Text emphasis="muted">{row().installed ? "It doesn't ask for any permissions." : 'A built-in plugin ships with acorn and runs with acorn\'s own access.'}</Text>}>
          {(line) => <SettingRow label={line.text}><Show when={line.high}><Badge tone="warn">Broad access</Badge></Show></SettingRow>}
        </For>
      </SettingsSection>
      <SettingsSection id="approvals" label="Approvals on this computer" help="You approve each version of a plugin before this computer runs it.">
        <For each={decisions()} fallback={<Text emphasis="muted">{row().installed?.bundled || (props.plugin.kind === 'node' && !row().installed) ? "Built in, so there's nothing to approve." : 'No approvals.'}</Text>}>
          {(ack) => (
            <SettingRow label={`${ack.version}: ${ack.decision === 'accepted' ? 'approved' : 'rejected'}`}>
              <Button size="sm" variant="ghost" disabled={props.busy || !!props.devGrant} onPress={() => void forget(ack.hash, ack.decision === 'accepted')}>
                {ack.decision === 'accepted' ? 'Revoke approval' : 'Review again'}
              </Button>
            </SettingRow>
          )}
        </For>
      </SettingsSection>
      <Show when={!row().installed?.bundled && (props.plugin.kind === 'device' || row().installed)}>
        <SettingsSection id="dev" label="Development mode">
          <SettingRow
            label={props.devGrant ? 'In development' : 'Off'}
            description={props.devGrant
              ? 'This computer runs each new version of this plugin without asking. Turn it off when you finish working on the plugin.'
              : props.plugin.kind === 'device'
                ? "For a plugin you're writing: runs each new version without asking."
                : "Runs each new version without asking. It turns on when you let an agent install a plugin it's writing."}
          >
            <Show
              when={props.devGrant}
              fallback={<Show when={props.plugin.kind === 'device'}><Button size="sm" variant="ghost" disabled={props.busy} onPress={() => void setDevMode(true)}>Turn on</Button></Show>}
            >
              <Button size="sm" disabled={props.busy} onPress={() => void setDevMode(false)}>Turn off</Button>
            </Show>
          </SettingRow>
        </SettingsSection>
      </Show>
    </>
  )
}

// Which version is on disk and which is running, and the one way to change it. No background check and no
// "an update is available" badge (docs/security/plugin-storage-and-supply-chain.md § Supply chain): an update is the moment a compromised
// maintainer gets to run new code, so it happens when the owner asks.
function Versions(props: PluginPageProps & Actions) {
  const row = () => pluginRow(props.plugin)
  const installed = () => row().installed
  const updatable = () => (props.plugin.kind === 'device' ? !!props.plugin.entry.installSource : !!installed() && !installed()?.bundled)
  const update = () => props.run(async () => {
    if (props.plugin.kind === 'device') {
      const source = props.plugin.entry.installSource
      if (!source) throw new Error('This plugin has no recorded source to update from.')
      await installPluginOnDevice(source, props.plugin.id)
      await props.settleDevice()
      return
    }
    const result = await updateNodePlugin(props.plugin.id, {}, props.nodeId ?? undefined)
    await props.settleNode()
    if (result.fromVersion === result.toVersion) throw new Error(`${pluginName(props.plugin)} is already at ${result.toVersion}.`)
  })
  const source = () => (props.plugin.kind === 'device' ? props.plugin.entry.sourceLabel : installed()?.source)
  const offeredBy = () => (props.plugin.kind === 'device' ? props.plugin.entry.nodeIds : [])
  // A built-in's source is the app itself, which the node words for a log rather than for a person.
  const sourceText = () => (props.plugin.kind === 'node' && installed()?.bundled ? 'Built in' : source() ?? '')
  return (
    <SettingsSection
      id="versions"
      label="Installed version"
      help={installed() ? `Built for plugin API ${installed()?.apiVersion}.` : 'Ships with this version of acorn.'}
    >
      {/* Facts, not setting rows: nothing here is a setting (B05's column rule). */}
      <Facts
        grouping="rows"
        items={[
          { label: 'Version', value: installed()?.version ?? 'Built in' },
          ...(row().active && row().active?.version !== installed()?.version
            ? [{ label: 'Running', value: `${row().active?.version}, until the node restarts` }]
            : []),
          ...(source() ? [{ label: 'Source', value: sourceText() }] : []),
          ...(installed()?.installedAt ? [{ label: 'Installed on', value: new Date(installed()!.installedAt!).toLocaleString() }] : []),
          ...(offeredBy().length ? [{ label: 'Also offered by', value: offeredBy().join(', ') }] : []),
        ]}
      />
      <Show when={updatable()}>
        <SettingRow label="Update" description="Gets the newest version from where it was installed. You approve it before it runs.">
          <Button size="sm" variant="ghost" disabled={props.busy || !!(props.plugin.kind === 'node' && props.plugin.row.pendingReview)} onPress={() => void update()}>Update</Button>
        </SettingRow>
      </Show>
    </SettingsSection>
  )
}

// Keeping the data is the default everywhere else a plugin goes away, so it is its own button and not a
// checkbox inside a confirmation, which is how someone deletes a year of notes by reflex.
function DangerZone(props: PluginPageProps & Actions & { nodeRow: NodePluginRow | undefined }) {
  const qc = useQueryClient()
  const removable = () => (props.plugin.kind === 'device' ? true : !!props.nodeRow && ((!!props.nodeRow.installed && !props.nodeRow.installed.bundled) || !!props.nodeRow.pendingReview))
  const uninstall = (purgeData: boolean) => props.run(async () => {
    const id = props.plugin.id
    const name = pluginName(props.plugin)
    const confirmed = await confirmAction({
      title: `Uninstall ${name}`,
      actionLabel: purgeData ? 'Uninstall and delete its data' : 'Uninstall',
      goes: purgeData
        ? `${name} is removed from this node, with everything it stored there.`
        : `${name} is removed from this node. It stops when the node next restarts.`,
      stays: purgeData ? 'Other plugins and their data stay as they are.' : 'Its data stays on the node, so installing it again picks up where it left off.',
      danger: true,
    })
    if (!confirmed) return
    await uninstallNodePlugin(id, { purgeData }, props.nodeId ?? undefined)
    props.onBack()
    await props.settleNode()
  })
  const remove = () => props.run(async () => {
    const id = props.plugin.id
    const name = pluginName(props.plugin)
    const confirmed = await confirmAction({
      title: `Remove ${name} from this device`,
      actionLabel: 'Remove',
      goes: `${name} and every preference this device kept for it are removed.`,
      stays: 'Nothing on any node changes.',
      danger: true,
    })
    if (!confirmed) return
    await removeDevicePlugin(qc, id)
    props.onBack()
    await props.settleDevice()
  })
  return (
    <Show when={removable()}>
      <SettingsSection id="danger" label="Danger zone" tone="danger">
        <Show
          when={props.plugin.kind === 'node'}
          fallback={
            <SettingRow label="Remove from this device" description="It stops at once.">
              <Button size="sm" tone="danger" disabled={props.busy} onPress={() => void remove()}>Remove</Button>
            </SettingRow>
          }
        >
          <SettingRow label="Uninstall, keep its data" description="Its data stays, so a reinstall picks up where it left off.">
            <Button size="sm" disabled={props.busy} onPress={() => void uninstall(false)}>Keep its data</Button>
          </SettingRow>
          <SettingRow label="Uninstall and delete its data" description="Everything it stored on this node goes too. This cannot be undone.">
            <Button size="sm" tone="danger" disabled={props.busy} onPress={() => void uninstall(true)}>Delete its data</Button>
          </SettingRow>
        </Show>
      </SettingsSection>
    </Show>
  )
}
