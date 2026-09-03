import type { QueryClient } from '@tanstack/solid-query'
import type { CommandSettingOption } from '@acorn/protocol/commands.ts'
import { readDevicePrefs } from '../../../infra/persistence/devicePrefs'
import { canSetBadge } from '../../../infra/platform'
import { activeTaskId } from '../../../features/tasks/tasks'
import { defaultDeliveryContext, deliverNotice } from '../../../features/notifications/deliver'
import {
  readNotificationSettings,
  saveNotificationEvent,
  saveNotificationSettings,
  type NotificationSettings,
} from '../../../features/notifications/settings'
import {
  appearanceStyle,
  darkTheme,
  fixedTheme,
  lightTheme,
  saveAppearanceStyle,
  saveDarkTheme,
  saveFixedTheme,
  saveLightTheme,
  saveThemeFollowsSystem,
  styleChoices,
  themeChoices,
  themeFollowsSystem,
} from '../../../features/settings/appearancePrefs'
import { settingsContributions } from '../shell/settings'
import type { ContributedCommand } from './commands'

// Core's own catalogue: the groups the shell's commands hang under, the Settings pages as rows, and
// the two settings core owns (docs/future/command-palette/command-catalog.md § Core).
//
// Builders rather than a registration, because what a host can honour differs: the desktop has a
// Settings modal and paints themes, and the terminal has neither. Each shell registers the ones it can
// answer for, which is the same rule the settings pages themselves already follow — they are
// contributed by the app, not by this package.
//
// **A setting is not a toggle.** Every Boolean here is an explicit On and Off with the current value
// marked, so the command shows what is set, means the same thing pressed twice, and reads the same as
// a theme picker (docs/future/command-palette/refused.md § Free-form secret settings draws the other
// edge of the same line). Nothing here is free text, a secret, or a field that depends on another;
// those stay pages.
//
// **Nothing here is a second persistence path.** Every read and every write goes through the same
// accessor the Settings page calls — `features/settings/appearancePrefs.ts` and
// `features/notifications/settings.ts` — because a value written two ways is a value that starts
// disagreeing with itself.

/** The two choices a Boolean setting offers. */
export const BOOLEAN_CHOICES: readonly CommandSettingOption[] = [
  { value: 'on', label: 'On', keywords: ['yes', 'enable'] },
  { value: 'off', label: 'Off', keywords: ['no', 'disable'] },
]

const boolValue = (on: boolean): string => (on ? 'on' : 'off')
const isOn = (value: string): boolean => value === 'on'

/**
 * Every appearance preference is a device preference, so localStorage is the whole truth and the
 * accessor can be handed the device store directly (infra/persistence/devicePrefs.ts). The page reads
 * the same values out of the prefs query, which merges this store over the node's answer with the
 * device winning, so the two readers cannot disagree.
 */
const devicePrefs = (): Record<string, string> => readDevicePrefs()

export const CORE_GO_TO_GROUP = 'core.goto'
export const CORE_SETTINGS_GROUP = 'core.settings.pages'
export const CORE_APPEARANCE_GROUP = 'core.appearance'
export const CORE_NOTIFICATIONS_GROUP = 'core.notifications'

/** Where the navigation searches live. Registered by each host, because what it can navigate to
 *  differs; the group is shared so the breadcrumb reads the same in both. */
export const goToGroup = (): ContributedCommand => ({
  id: CORE_GO_TO_GROUP,
  kind: 'group',
  title: 'Go to',
  hint: 'tasks, workspaces, projects and nodes',
  category: 'navigation',
  palette: true,
  scope: 'none',
  order: 100,
})

/**
 * The Settings pages, as one row each.
 *
 * Generated from `settingsRegistry` rather than declared, because a plugin contributes pages and a
 * hand-written list would go stale the moment one loads. It is not a reflection of the pages'
 * *contents*: a page is an arbitrary component, and scraping one would couple the palette to rendering
 * and create the second persistence path this whole file exists to avoid
 * (docs/future/command-palette/refused.md § Reflecting Settings pages into commands). What is
 * generated is one action that opens the modal where the reader asked for it.
 *
 * The registry is a signal, so the caller re-registers when it changes.
 */
export function settingsPageCommands(open: (pageId: string) => void): ContributedCommand[] {
  return [
    {
      id: CORE_SETTINGS_GROUP,
      kind: 'group',
      title: 'Settings',
      hint: 'open a settings page',
      category: 'navigation',
      palette: true,
      scope: 'none',
      order: 800,
    },
    // Workspace pages are excluded: their row would need a workspace to name, and the modal picks one
    // from its own list. The general pages are the ones that mean something without a selection.
    ...settingsContributions().filter((page) => page.group === 'general').map((page): ContributedCommand => ({
      id: `${CORE_SETTINGS_GROUP}.${page.id}`,
      parentId: CORE_SETTINGS_GROUP,
      title: page.title ?? page.label,
      category: 'navigation',
      palette: true,
      scope: 'none',
      order: page.order,
      ...(page.requires ? { requires: page.requires } : {}),
      run: () => open(page.id),
    })),
  ]
}

/** Style, follow-the-OS, and whichever theme the follow setting makes applicable. */
export function appearanceCommands(qc: QueryClient): ContributedCommand[] {
  const following = (): boolean => themeFollowsSystem(devicePrefs())
  return [
    {
      id: CORE_APPEARANCE_GROUP,
      kind: 'group',
      title: 'Appearance',
      hint: 'style and theme',
      category: 'navigation',
      palette: true,
      scope: 'none',
      order: 810,
    },
    {
      id: `${CORE_APPEARANCE_GROUP}.style`,
      parentId: CORE_APPEARANCE_GROUP,
      kind: 'setting',
      title: 'Style',
      hint: 'shape, typography and density',
      category: 'navigation',
      palette: true,
      scope: 'none',
      order: 100,
      read: () => Promise.resolve(appearanceStyle(devicePrefs())),
      // A function, not a snapshot: a plugin may contribute a style, and the registry behind this is a
      // signal (features/settings/uiStyles.ts).
      get options() { return styleChoices() },
      write: async (value) => {
        await saveAppearanceStyle(qc, value)
        return appearanceStyle(devicePrefs())
      },
    },
    {
      id: `${CORE_APPEARANCE_GROUP}.follow-system`,
      parentId: CORE_APPEARANCE_GROUP,
      kind: 'setting',
      title: 'Follow the system light/dark setting',
      category: 'navigation',
      palette: true,
      scope: 'none',
      order: 200,
      read: () => Promise.resolve(boolValue(following())),
      options: BOOLEAN_CHOICES,
      write: async (value) => {
        await saveThemeFollowsSystem(qc, isOn(value))
        return boolValue(following())
      },
    },
    // The three theme pickers are the page's three, and each appears exactly where the page shows it:
    // one fixed theme when the reader is not following the OS, a light and a dark one when they are.
    // A row that could only write a value nothing reads is worse than a missing row.
    {
      id: `${CORE_APPEARANCE_GROUP}.theme`,
      parentId: CORE_APPEARANCE_GROUP,
      kind: 'setting',
      title: 'Theme',
      category: 'navigation',
      palette: true,
      scope: 'none',
      order: 300,
      when: () => !following(),
      read: () => Promise.resolve(fixedTheme(devicePrefs())),
      get options() { return themeChoices() },
      write: async (value) => {
        await saveFixedTheme(qc, value)
        return fixedTheme(devicePrefs())
      },
    },
    {
      id: `${CORE_APPEARANCE_GROUP}.theme-light`,
      parentId: CORE_APPEARANCE_GROUP,
      kind: 'setting',
      title: 'Light theme',
      category: 'navigation',
      palette: true,
      scope: 'none',
      order: 400,
      when: following,
      read: () => Promise.resolve(lightTheme(devicePrefs())),
      get options() { return themeChoices() },
      write: async (value) => {
        await saveLightTheme(qc, value)
        return lightTheme(devicePrefs())
      },
    },
    {
      id: `${CORE_APPEARANCE_GROUP}.theme-dark`,
      parentId: CORE_APPEARANCE_GROUP,
      kind: 'setting',
      title: 'Dark theme',
      category: 'navigation',
      palette: true,
      scope: 'none',
      order: 500,
      when: following,
      read: () => Promise.resolve(darkTheme(devicePrefs())),
      get options() { return themeChoices() },
      write: async (value) => {
        await saveDarkTheme(qc, value)
        return darkTheme(devicePrefs())
      },
    },
  ]
}

/** The six notification switches and the test notification beside them. */
export function notificationCommands(qc: QueryClient): ContributedCommand[] {
  // The gate's own reader, which is the device store rather than the query cache: this key never
  // reaches a node, and `savePref` writes the store before it touches the cache. So reading it back
  // after a write is reading what was actually stored, not what was asked for.
  const current = (): NotificationSettings => readNotificationSettings()

  const channel = (
    id: string,
    title: string,
    order: number,
    of: (settings: NotificationSettings) => boolean,
    patch: (on: boolean) => Partial<NotificationSettings>,
    when?: () => boolean,
  ): ContributedCommand => ({
    id: `${CORE_NOTIFICATIONS_GROUP}.${id}`,
    parentId: CORE_NOTIFICATIONS_GROUP,
    kind: 'setting',
    title,
    category: 'navigation',
    palette: true,
    scope: 'none',
    order,
    ...(when ? { when } : {}),
    read: () => Promise.resolve(boolValue(of(current()))),
    options: BOOLEAN_CHOICES,
    write: async (value) => {
      await saveNotificationSettings(qc, current(), patch(isOn(value)))
      return boolValue(of(current()))
    },
  })

  const event = (
    id: string,
    title: string,
    order: number,
    key: keyof NotificationSettings['events'],
  ): ContributedCommand => ({
    id: `${CORE_NOTIFICATIONS_GROUP}.${id}`,
    parentId: CORE_NOTIFICATIONS_GROUP,
    kind: 'setting',
    title,
    category: 'navigation',
    palette: true,
    scope: 'none',
    order,
    read: () => Promise.resolve(boolValue(current().events[key])),
    options: BOOLEAN_CHOICES,
    write: async (value) => {
      await saveNotificationEvent(qc, current(), { [key]: isOn(value) })
      return boolValue(current().events[key])
    },
  })

  return [
    {
      id: CORE_NOTIFICATIONS_GROUP,
      kind: 'group',
      title: 'Notifications',
      hint: 'sound, system notices and which edges are worth one',
      category: 'navigation',
      palette: true,
      scope: 'none',
      order: 820,
    },
    channel('sound', 'Play a sound', 100, (settings) => settings.sound, (sound) => ({ sound })),
    channel('system', 'Show a system notification', 200, (settings) => settings.system, (system) => ({ system })),
    // Absent rather than greyed out where the host cannot draw a number on the app icon, which is the
    // same decision Settings → Notifications makes about the same row.
    // `app-icon` and not `badge` in the id: a bare `badge` is a Lucide name, and the icon census reads
    // string literals rather than call sites (kit/tokens/iconCensus.test.ts).
    channel('app-icon', 'Show a count on the app icon', 300, (settings) => settings.badge, (badge) => ({ badge }), canSetBadge),
    event('event-blocked', 'Notify me when an agent needs me', 400, 'blocked'),
    event('event-finished', 'Notify me when an agent finishes', 500, 'finished'),
    event('event-error', 'Notify me when an agent fails', 600, 'error'),
    {
      id: `${CORE_NOTIFICATIONS_GROUP}.test`,
      parentId: CORE_NOTIFICATIONS_GROUP,
      title: 'Send a test notification',
      hint: 'fires every channel the switches above allow',
      category: 'action',
      palette: true,
      scope: 'none',
      order: 700,
      // Unseen on purpose, exactly as the page's button is: the point is to fire every channel the
      // switches allow, and an edge on the task you are looking at is meant to be quiet.
      run: () => {
        deliverNotice(
          { taskId: activeTaskId() ?? '', kind: 'agent-needs-input', title: 'Test agent needs you', at: Date.now() },
          { ...defaultDeliveryContext, focused: () => false },
        )
      },
    },
  ]
}
