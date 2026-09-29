import { createMemo, For, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { activeNodeId } from '../../../infra/node/activeNode'
import { nodePlugins } from '../../../infra/node/nodePlugins'
import { devicePlugins, distribution } from '../../../host/plugins/distribution'
import { Button, Checkbox } from '../../../kit/components/primitives'
import { createRailVisibility, pluginSources } from '../../tabs/railVisibility'
import { createSettingSave } from '../settingSave'
import { openPluginPage, pluginOrigin, statusOf, type InstalledPlugin } from './installed'
import { setDevicePluginEnabled, setNodePluginEnabled } from './pluginActions'
import type { SettingsNavigate } from '../../../host/registries/shell/settings'

// The plugin strip: the host's handle on a plugin, drawn above every page a plugin contributes to
// settings, whether the page is compiled, a remote tree or a frame (docs/frontend.md § The plugin strip).
// It names the plugin and where it came from, opens its page under Installed, and holds the two switches
// only the host may draw: whether the plugin is on, and whether each of its sources has an icon in the
// left rail. Then a line for the four states a person has to know about before trusting what the page
// shows: off, waiting for approval, failed, and offline.
//
// The caller draws it outside the plugin's content, as an earlier sibling of the box the content sits
// in, so nothing the plugin draws can sit over it or stand in for it (../SettingsView.tsx).
//
// A plugin's page reads the active node (../../../host/frames/register.ts § frameNode), so the strip
// describes the plugin there too.

export function PluginStrip(props: {
  pluginId: string
  /** The page's `railSourceVisibility`. Only the plugin's own registered sources get a switch. */
  railSources?: readonly string[]
  navigate: SettingsNavigate
}) {
  const qc = useQueryClient()
  const visibility = createRailVisibility()
  const plugin = createMemo((): InstalledPlugin | undefined => {
    const entry = devicePlugins().find((candidate) => candidate.row.name === props.pluginId)
    if (entry) return { kind: 'device', id: props.pluginId, entry }
    const row = nodePlugins()?.plugins.find((candidate) => candidate.name === props.pluginId)
    return row ? { kind: 'node', id: props.pluginId, row } : undefined
  })
  const status = () => {
    const current = plugin()
    return current ? statusOf(distribution(), activeNodeId(), current, false) : undefined
  }
  // Checked again here, and not only at registration: a switch is drawn only for a source this plugin
  // really registered, under the owner the registry recorded.
  const rail = createMemo(() => pluginSources(props.pluginId).map(({ pluginId, source }) => ({ pluginId, ...source })).filter((source) => props.railSources?.includes(source.id)))
  const enabled = () => {
    const current = plugin()
    return current?.kind === 'device' ? !current.entry.row.disabled : !current?.row.disabled
  }
  const togglable = () => {
    const current = plugin()
    return !!current && (current.kind === 'device' || !current.row.required)
  }
  const enableSave = createSettingSave()
  // One per source, so a failed switch's error does not stand beside the others.
  const railSaves = new Map<string, ReturnType<typeof createSettingSave>>()
  const railSave = (id: string) => {
    let save = railSaves.get(id)
    if (!save) railSaves.set(id, save = createSettingSave())
    return save
  }
  const setEnabled = (on: boolean) => enableSave.run(async () => {
    const current = plugin()
    if (!current) return
    if (current.kind === 'node') {
      await setNodePluginEnabled(nodePlugins()?.plugins ?? [], current.id, on)
      return
    }
    await setDevicePluginEnabled(qc, current.id, on)
    // A device plugin stops at once and its page goes with it, so the person lands where they can turn
    // it back on rather than on the first page settings has.
    if (!on) openPluginPage(props.navigate, current.id, 'device')
  })
  const line = () => {
    const current = status()
    if (!current?.line) return undefined
    return current.line === 'disabled' ? `${current.text} This page still saves.` : current.text
  }

  return (
    <div class="settings-plugin-strip" role="region" aria-label={`${props.pluginId} plugin`}>
      <div class="settings-plugin-strip-row">
        <span class="settings-plugin-strip-name">
          <strong>{props.pluginId}</strong> plugin<Show when={plugin()}>{(current) => `, ${pluginOrigin(current())}`}</Show>
        </span>
        <Button variant="bare" size="sm" onPress={() => openPluginPage(props.navigate, props.pluginId, plugin()?.kind)}>Manage plugin</Button>
        <span class="settings-plugin-strip-controls">
          <For each={rail()}>
            {(source) => (
              <Checkbox
                switch
                size="sm"
                label={rail().length > 1 ? `Show ${source.label} in left rail` : 'Show in left rail'}
                checked={visibility.shown(source.id)}
                onChange={(on) => railSave(source.id).run(() => visibility.setShown(source.pluginId, source.id, on, { throwOnFailure: true }))}
              />
            )}
          </For>
          <Show when={togglable()}>
            <Checkbox switch size="sm" label="Enabled" checked={enabled()} onChange={setEnabled} />
          </Show>
        </span>
      </div>
      <Show when={line()}>
        {(text) => <p class="settings-plugin-strip-status" role="status" data-tone={status()?.tone}>{text()}</p>}
      </Show>
      <Show when={enableSave.error() ?? rail().map((source) => railSave(source.id).error()).find(Boolean)}>
        {(message) => <p class="settings-error" role="alert">{message()}</p>}
      </Show>
    </div>
  )
}
