import { createRoot } from 'solid-js'
import { QueryClient } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prefsKey } from '@acorn/protocol/api.ts'
import type { Disposable } from '../../../kit/lib/registry'
import { PrefKeys } from '../../../infra/persistence/prefKeys'
import { readDevicePrefs } from '../../../infra/persistence/devicePrefs'
import {
  appearanceStyle,
  themeFollowsSystem,
} from '../../../features/settings/appearancePrefs'
import { parseNotificationSettings, readNotificationSettings } from '../../../features/notifications/settings'
import { settingsRegistry } from '../shell/settings'
import { buildCommandGraph } from './graph'
import {
  appearanceCommands,
  notificationCommands,
  settingsPageCommands,
} from './coreCommands'
import { commandRegistry, type CommandContribution, type SettingCommand } from './commands'
import { DETACHED_COMMAND_CONTEXT } from './commands'

// Core's own catalogue, and the one rule it exists to keep: a setting a person can change from two
// places has one accessor, and both places call it.
//
// So the assertions here are deliberately about the *store* rather than about the command. A write
// that landed in the query cache and not in the device store, or in the device store under a shape
// the page's parser does not read back, is exactly the drift a second persistence path causes, and
// it is invisible to a test that only checks what the command returned.

const held: Disposable[] = []
const register = (commands: CommandContribution[]): void => {
  for (const command of commands) held.push(commandRegistry.register(command))
}
const settingFor = (id: string): SettingCommand => commandRegistry.get(id) as SettingCommand
const signal = (): AbortSignal => new AbortController().signal

let qc: QueryClient

beforeEach(() => {
  localStorage.clear()
  qc = new QueryClient()
})

afterEach(() => {
  for (const disposable of held.splice(0).reverse()) disposable.dispose()
  localStorage.clear()
})

describe('the appearance settings', () => {
  it('writes through the accessor the page reads, so both see the same value', async () => {
    register(appearanceCommands(qc))
    const style = settingFor('core.appearance.style')
    await expect(style.read(DETACHED_COMMAND_CONTEXT, signal())).resolves.toBe('terminal')

    await expect(style.write('cozy', DETACHED_COMMAND_CONTEXT, signal())).resolves.toBe('cozy')
    // The device store, which is what `prefsOptions` merges over the node's answer.
    expect(readDevicePrefs()[PrefKeys.style]).toBe('cozy')
    // The page's own reader, given the page's own input.
    expect(appearanceStyle(qc.getQueryData<Record<string, string>>(prefsKey))).toBe('cozy')
  })

  it('updates the query cache the whole shell restyles from, not just its own answer', async () => {
    register(appearanceCommands(qc))
    await settingFor('core.appearance.theme').write('dracula', DETACHED_COMMAND_CONTEXT, signal())
    expect(qc.getQueryData<Record<string, string>>(prefsKey)?.[PrefKeys.theme]).toBe('dracula')
  })

  it('offers On and Off for the follow-the-system switch, and is idempotent', async () => {
    register(appearanceCommands(qc))
    const follow = settingFor('core.appearance.follow-system')
    expect(follow.options.map((option) => option.value)).toEqual(['on', 'off'])
    // Follow the OS until something is picked, which is what the page shows on a fresh install.
    await expect(follow.read(DETACHED_COMMAND_CONTEXT, signal())).resolves.toBe('on')

    await expect(follow.write('off', DETACHED_COMMAND_CONTEXT, signal())).resolves.toBe('off')
    await expect(follow.write('off', DETACHED_COMMAND_CONTEXT, signal())).resolves.toBe('off')
    expect(themeFollowsSystem(readDevicePrefs())).toBe(false)
  })

  it('shows the theme the follow switch makes applicable, and only that one', () => {
    register(appearanceCommands(qc))
    const available = (): string[] => [...buildCommandGraph(commandRegistry.entries()).nodes.values()]
      .filter((node) => node.available && node.id.startsWith('core.appearance.theme'))
      .map((node) => node.id)
    // Following the OS: a light theme and a dark theme.
    expect(available()).toEqual(['core.appearance.theme-light', 'core.appearance.theme-dark'])

    localStorage.setItem(`acorn-pref:${PrefKeys.themeFollowSystem}`, 'false')
    expect(available()).toEqual(['core.appearance.theme'])
  })
})

describe('the notification settings', () => {
  it('merges one switch onto the record rather than replacing it', async () => {
    register(notificationCommands(qc))
    await settingFor('core.notifications.sound').write('off', DETACHED_COMMAND_CONTEXT, signal())
    await settingFor('core.notifications.event-finished').write('off', DETACHED_COMMAND_CONTEXT, signal())

    const stored = readNotificationSettings()
    expect(stored.sound).toBe(false)
    expect(stored.events.finished).toBe(false)
    // Everything the two writes did not name is still on. Six booleans share one key, so an unmerged
    // write would have turned the other four off.
    expect(stored.system).toBe(true)
    expect(stored.badge).toBe(true)
    expect(stored.events.blocked).toBe(true)
    expect(stored.events.error).toBe(true)
    // And the page's parser reads back what the command wrote.
    expect(parseNotificationSettings(qc.getQueryData<Record<string, string>>(prefsKey)?.[PrefKeys.notifications]))
      .toEqual(stored)
  })

  it('is idempotent, and reports the value that was actually stored', async () => {
    register(notificationCommands(qc))
    const system = settingFor('core.notifications.system')
    await expect(system.write('off', DETACHED_COMMAND_CONTEXT, signal())).resolves.toBe('off')
    await expect(system.write('off', DETACHED_COMMAND_CONTEXT, signal())).resolves.toBe('off')
    await expect(system.read(DETACHED_COMMAND_CONTEXT, signal())).resolves.toBe('off')
  })

  it('hides the app-icon badge where the host cannot draw one', () => {
    register(notificationCommands(qc))
    const badge = () => buildCommandGraph(commandRegistry.entries()).nodes.get('core.notifications.app-icon')
    // jsdom with no shell behind it: the same answer a browser tab gives, and the same one that keeps
    // the row off Settings → Notifications.
    expect(badge()?.available).toBe(false)

    vi.stubGlobal('window', Object.assign(window, { acorn: { notify: () => {} } }))
    expect(badge()?.available).toBe(true)
    vi.unstubAllGlobals()
    Reflect.deleteProperty(window, 'acorn')
  })
})

describe('the Settings pages', () => {
  it('generates one row per registered general page, in the pages’ own order', () => {
    const opened: string[] = []
    held.push(settingsRegistry.register({
      id: 'appearance', label: 'Appearance', group: 'general', order: 10, component: () => null,
    }))
    held.push(settingsRegistry.register({
      id: 'shortcuts', label: 'Shortcuts', title: 'Keyboard shortcuts', group: 'general', order: 70, component: () => null,
    }))
    // A workspace page names no workspace on its own; the modal picks one from its own list.
    held.push(settingsRegistry.register({
      id: 'workspace.detail', label: 'Workspace', group: 'workspace', order: 0, component: () => null,
    }))

    register(settingsPageCommands((page) => opened.push(page)))
    const graph = buildCommandGraph(commandRegistry.entries())
    expect(graph.children('core.settings.pages').map((node) => node.title))
      .toEqual(['Appearance', 'Keyboard shortcuts'])

    createRoot((dispose) => {
      const row = graph.children('core.settings.pages')[0]
      void (row.command as { run: (context: typeof DETACHED_COMMAND_CONTEXT) => void }).run(DETACHED_COMMAND_CONTEXT)
      dispose()
    })
    expect(opened).toEqual(['appearance'])
  })
})
