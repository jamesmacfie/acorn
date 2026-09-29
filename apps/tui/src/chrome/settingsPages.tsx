/** @jsxImportSource @acorn/tui/jsx */
import { lazy } from 'solid-js'
import { join } from 'node:path'
import { CORE_SETTINGS_PAGES, type CoreSettingsPageId } from '@acorn/client-core/features/settings'
import {
  SETTINGS_CATEGORY_LABELS, settingsCategoryOf, settingsRegistry, settingsScopeOf, type SettingsContribution,
} from '@acorn/client-core/host/registries/shell'
import { configDir } from '../node/paths'

// Which settings pages this host draws, and what it says about the rest (docs/tui.md § Settings).
//
// The list is the desktop's: core's pages come from the one declaration table in client-core, and the
// roster's plugins register theirs through `ctx.settingsPages` exactly as they do on the desktop. So
// the terminal's Settings route has the same nine groups, the same pages in the same order and the same
// labels, and a page that moves group moves here too.
//
// What differs is what is drawn. Core's pages are written with the desktop's own components, so this
// host draws only the ones it has a terminal form for. A plugin's page is written with the kit and draws
// here unchanged, unless every row on it shapes something this host does not have. Everything else is
// still listed, and opening it says which host to use and why, rather than drawing controls that would
// write values nothing here reads.

/** Core's pages with a form of their own on this host. */
const TERMINAL_FORMS: Partial<Record<CoreSettingsPageId, SettingsContribution['component']>> = {
  notifications: lazy(() => import('./TerminalNotifications')),
}

/** A plugin page whose rows all shape a surface this host does not draw, and why. Named by page id,
 *  because this is the host saying what it cannot honour, which the plugin cannot know. */
const PLUGIN_PAGES_NOT_DRAWN: Record<string, string> = {
  terminal: 'Its settings choose how the desktop app\'s terminal drawer opens and the size of its text. '
    + 'This client opens terminal sessions full screen, in your own terminal\'s font.',
}

/** Why a core page has no terminal form, where there is a better reason than the general one. */
const WHY_NOT_HERE: Partial<Record<CoreSettingsPageId, string>> = {
  shortcuts: 'Recording a shortcut needs the key press itself, and a terminal passes only some key combinations through.',
  cli: 'It installs the acorn command for the desktop app. You are running that command already.',
  nodes: 'To pair this terminal with another node, start it with acorn --node <address>.',
}

/** Device pages whose values this client reads from its own acorn.json, so a person can set them here
 *  by editing that file (docs/tui.md § Where the TUI keeps things). */
const IN_DEVICE_CONFIG = new Set<string>(['appearance', 'shortcuts', 'rail-surfaces', 'device-config'])

const CORE_PAGE_IDS = new Set<string>(CORE_SETTINGS_PAGES.map((page) => page.id))

export type DrawnElsewhere = {
  /** Why this host does not draw the page. */
  why: string
  /** Which host to open instead, and what a change there reaches. */
  where: string
  /** This client's own file for the page's values, when it has one. */
  file?: string
  /** The page is about workspaces and projects, which the setup route can create from here. */
  setup?: boolean
}

/** What the route shows instead of a page this host does not draw, or `undefined` when it draws it. */
export function drawnElsewhere(page: SettingsContribution): DrawnElsewhere | undefined {
  const pluginReason = PLUGIN_PAGES_NOT_DRAWN[page.id]
  const core = CORE_PAGE_IDS.has(page.id)
  if (!pluginReason && (!core || TERMINAL_FORMS[page.id as CoreSettingsPageId])) return undefined
  const path = `Settings > ${SETTINGS_CATEGORY_LABELS[settingsCategoryOf(page)]} > ${page.title ?? page.label}`
  const why = pluginReason
    ?? WHY_NOT_HERE[page.id as CoreSettingsPageId]
    ?? 'The page is drawn with the desktop app\'s own controls, which have no terminal form.'
  if (settingsScopeOf(page) === 'device') {
    return {
      why,
      where: `${path} in the desktop app acts on that computer only. The page belongs to the device it is open on, so nothing set there reaches this terminal.`,
      ...(IN_DEVICE_CONFIG.has(page.id) ? { file: join(configDir(), 'acorn.json') } : {}),
    }
  }
  return {
    why,
    where: `Open ${path} in the desktop app on a computer paired with this node. The node keeps these settings, so a change there applies here too.`,
    ...(page.id === 'workspaces' ? { setup: true } : {}),
  }
}

// Registered as pages rather than listed beside the registry, so the palette's Settings rows, the
// route and a deep link all read one list. A page with no terminal form registers a component that
// draws nothing, because the route shows `drawnElsewhere` in its place and never mounts it.
const drawsNothing = () => null

/** Register core's pages for this host. Returns the teardown, which the shell runs on unmount. */
export function registerCoreSettingsPages(): () => void {
  const registered = CORE_SETTINGS_PAGES.map((page) =>
    settingsRegistry.register({ ...page, component: TERMINAL_FORMS[page.id] ?? drawsNothing }))
  return () => { for (const entry of registered) entry.dispose() }
}
