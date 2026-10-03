import { z } from 'zod'
import {
  commandSettingOptionSchema, MAX_COMMAND_SEARCH_MIN_QUERY, MAX_COMMAND_SEARCH_DEBOUNCE_MS,
  MAX_COMMAND_SETTING_OPTIONS, MIN_COMMAND_SEARCH_DEBOUNCE_MS, MIN_COMMAND_SETTING_OPTIONS,
} from '../../chrome/commands.ts'
import { isNormalizedChord, isPluginShortcutChord } from '../../chrome/keybindings.ts'
import { contextFreeAction, selectedRowAction } from './chromeDescriptors.ts'
import { pluginRoute } from './manifestFields.ts'

export const commandCategory = z.enum(['action', 'navigation', 'pane', 'task', 'terminal', 'workspace'])

// What every kind of command declares. Ids are local: `chromeRegister.ts` qualifies both this one and
// `parentId` as `plugin.<pluginId>.<id>` and stamps the owner, so a manifest cannot name another
// plugin's group as its parent or claim another plugin's id
// (docs/command-palette-and-shortcuts.md).
const commandCommon = {
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  category: commandCategory.default('action'),
  palette: z.boolean().default(true),
  /** Secondary text on the row. */
  hint: z.string().min(1).max(160).optional(),
  /** What the root search matches on besides the title, for a command whose name is not what anybody
   *  types. */
  keywords: z.array(z.string().min(1).max(40)).max(16).optional(),
  /** Sibling order, before relevance. */
  order: z.number().int().min(0).max(100_000).optional(),
  /** A `group` this same manifest declares. Checked across the whole array by the manifest refinement,
   *  because a parent is another entry in the list and no field can see its siblings. */
  parentId: z.string().min(1).max(64).optional(),
}

// Which identity the host derives and sends, and it is not the whole vocabulary: `fleet` is missing on
// purpose. Fanning a manifest's route out over every paired node multiplies somebody else's network,
// rate limits and error noise on a declaration nobody reviewed per node, and the two scopes a loaded
// plugin actually needs — the open task and the routed project — are here. Core commands may still be
// fleet-scoped (@acorn/protocol/commands.ts).
const loadedCommandScope = z.enum(['none', 'task', 'project', 'workspace', 'node']).default('node')

export const actionCommandDescriptor = z.object({
  ...commandCommon,
  kind: z.literal('action'),
  action: contextFreeAction,
})

/** A parent. No action of its own: what it holds is the commands naming it as their `parentId`. */
export const groupCommandDescriptor = z.object({
  ...commandCommon,
  kind: z.literal('group'),
})

/**
 * A live query against one of this plugin's own routes.
 *
 * The host GETs `route` with `q` and the identifiers the declared scope owns, and it renders what
 * comes back as display facts (@acorn/protocol/commands.ts § CommandSearchItem). A result cannot
 * choose what picking it does: `onSelect` is one static verb from a closed set, declared here and
 * reviewed with the rest of the manifest (docs/command-palette-and-shortcuts/palette-data.md § What the palette
 * refuses). The set is a command's own plus `navigate`, because a picked row is a selected row and a
 * project-scoped search already has its project.
 */
export const searchCommandDescriptor = z.object({
  ...commandCommon,
  kind: z.literal('search'),
  scope: loadedCommandScope,
  // GET → { items: CommandSearchItem[] }, confined to this plugin's namespace by the refinement.
  route: pluginRoute,
  placeholder: z.string().min(1).max(120).optional(),
  minQueryLength: z.number().int().min(0).max(MAX_COMMAND_SEARCH_MIN_QUERY).optional(),
  // Floored as well as capped: a declared 5 ms is a plugin spending a request on every keystroke.
  debounceMs: z.number().int().min(MIN_COMMAND_SEARCH_DEBOUNCE_MS).max(MAX_COMMAND_SEARCH_DEBOUNCE_MS).optional(),
  onSelect: selectedRowAction,
})

/**
 * One line of text, submitted on Enter.
 *
 * The host POSTs `{ input, … }` to `route` and runs `onSuccess` only if the route answered. A failure
 * is the ordinary error envelope and keeps the reader's text where they typed it.
 */
export const inputCommandDescriptor = z.object({
  ...commandCommon,
  kind: z.literal('input'),
  scope: loadedCommandScope,
  // POST { input, taskId?, projectId?, workspaceId? } → { ok: true, item?, message? }
  route: pluginRoute,
  placeholder: z.string().min(1).max(120).optional(),
  onSuccess: contextFreeAction,
})

/**
 * A bounded choice with its current value shown.
 *
 * Two of this plugin's own routes and a static list of choices. The host GETs `readRoute` when the
 * frame opens and PUTs `writeRoute` when a choice is picked, and both answer `{ value }`; the value
 * that comes back has to name one of the choices declared here, which the host checks against its own
 * copy rather than trusting the answer.
 *
 * Deliberately not free text. A secret, a URL or a number needs validation, a reveal policy and a
 * recovery story that a list of labelled choices does not
 * (docs/command-palette-and-shortcuts/palette-data.md § What the palette refuses).
 */
export const settingCommandDescriptor = z.object({
  ...commandCommon,
  kind: z.literal('setting'),
  scope: loadedCommandScope,
  // GET → { value }
  readRoute: pluginRoute,
  // PUT { value, taskId?, projectId?, workspaceId? } → { value }
  writeRoute: pluginRoute,
  // Two is the fewest that is a choice; a list long enough to need scrolling is a settings page
  // (@acorn/protocol/commands.ts).
  options: z.array(commandSettingOptionSchema).min(MIN_COMMAND_SETTING_OPTIONS).max(MAX_COMMAND_SETTING_OPTIONS),
})

export const commandDescriptor = z.discriminatedUnion('kind', [
  actionCommandDescriptor,
  groupCommandDescriptor,
  searchCommandDescriptor,
  inputCommandDescriptor,
  settingCommandDescriptor,
])

export const keybindingDescriptor = z.object({
  command: z.string().min(1).max(64),
  defaultChord: z.string().min(1).max(64).superRefine((value, ctx) => {
    if (!isNormalizedChord(value)) {
      ctx.addIssue({ code: 'custom', message: 'shortcut must use canonical meta+ctrl+alt+shift+key order' })
    } else if (!isPluginShortcutChord(value)) {
      ctx.addIssue({ code: 'custom', message: 'plugin shortcuts require meta, ctrl, or alt' })
    }
  }),
  when: z.enum(['global', 'task', 'surface']),
  surface: z.string().min(1).max(64).optional(),
})
