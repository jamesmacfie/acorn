import { createSignal } from 'solid-js'
import type { QueryClient } from '@tanstack/solid-query'
import type { DeviceConfig } from '@acorn/protocol/deviceConfig.ts'
import type { PluginInstallSource } from '@acorn/protocol/api.ts'
import { deviceConfigBridge, type DeviceConfigState } from '../platform'
import { deviceConfigPrefs } from './deviceConfigPrefs'
import { savePref } from '../../features/settings/savePref'
import { pushBackgroundError } from '../../features/notifications/notifications'

export type ConfigPluginRequest = { id: string; source: PluginInstallSource }
const [requested, setRequested] = createSignal<ConfigPluginRequest[]>([])
export const configPluginRequests = requested

let stopped: (() => void) | undefined

/** The file is one more input to device prefs. It requests plugin installation but never grants it. */
export async function startDeviceConfigSync(
  client: () => QueryClient,
  onApplied?: (config: DeviceConfig) => void,
): Promise<() => void> {
  const bridge = deviceConfigBridge()
  if (!bridge) return () => {}
  let generation = 0
  const apply = async (state: DeviceConfigState): Promise<void> => {
    const own = ++generation
    if (state.error) {
      pushBackgroundError('', 'Could not read acorn.json', `${state.error.message} (line ${state.error.line}, column ${state.error.column}).`)
      return
    }
    onApplied?.(state.config)
    for (const [key, value] of Object.entries(deviceConfigPrefs(state.config))) {
      if (own !== generation) return
      await savePref(client(), key, value, { skipConfigWrite: true })
    }
    if (own === generation) setRequested((state.config.plugins ?? []) as ConfigPluginRequest[])
  }
  await apply(await bridge.read())
  const off = bridge.onChange((state) => void apply(state))
  const stop = () => { generation++; off(); if (stopped === stop) stopped = undefined }
  stopped?.()
  stopped = stop
  return stop
}

export const configPluginOffers = (installed: ReadonlySet<string>): ConfigPluginRequest[] =>
  requested().filter((entry) => !installed.has(entry.id))

export const selectedConfig = async (): Promise<DeviceConfig | null> =>
  (await deviceConfigBridge()?.read())?.config ?? null
