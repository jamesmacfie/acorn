import { z } from 'zod'
import {
  commandSettingOptionSchema,
  MAX_COMMAND_SEARCH_MIN_QUERY,
  MAX_COMMAND_SEARCH_DEBOUNCE_MS,
  MAX_COMMAND_SETTING_OPTIONS,
  MIN_COMMAND_SEARCH_DEBOUNCE_MS,
  MIN_COMMAND_SETTING_OPTIONS,
} from '../../chrome/commands.ts'
import { isNormalizedChord, isPluginShortcutChord } from '../../chrome/keybindings.ts'
import { contextFreeAction, selectedRowAction } from './chromeDescriptors.ts'
import { pluginRoute } from './manifestFields.ts'

export const commandCategory = z
  .enum(['action', 'navigation', 'pane', 'task', 'terminal', 'workspace'])
  .describe('The palette group the command is listed under.')

// What every kind of command declares. Ids are local: client-core's `pluginCommand` qualifies both this
// one and `parentId` as `plugin.<pluginId>.<id>` and stamps the owner, so a manifest cannot name another
// plugin's group as its parent or claim another plugin's id
// (docs/command-palette-and-shortcuts.md).
const commandCommon = {
  id: z
    .string()
    .min(1)
    .max(64)
    .describe(
      "The command's ID, unique in this manifest. A keybinding names it, and the host makes it `plugin.<pluginId>.<id>`.",
    ),
  title: z.string().min(1).max(120).describe("The command's name in the palette."),
  category: commandCategory.default('action'),
  palette: z
    .boolean()
    .default(true)
    .describe('Whether the palette lists it. Set `false` for a command only a keybinding runs.'),
  /** Secondary text on the row. */
  hint: z.string().min(1).max(160).optional().describe('Secondary text on the palette row.'),
  /** What the root search matches on besides the title, for a command whose name is not what anybody
   *  types. */
  keywords: z
    .array(z.string().min(1).max(40))
    .max(16)
    .optional()
    .describe('Words the palette search matches besides the title.'),
  /** Sibling order, before relevance. */
  order: z
    .number()
    .int()
    .min(0)
    .max(100_000)
    .optional()
    .describe('Order among its siblings, before search relevance. Lower comes first.'),
  /** A `group` this same manifest declares. Checked across the whole array by the manifest refinement,
   *  because a parent is another entry in the list and no field can see its siblings. */
  parentId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      "The ID of a `group` command in this manifest to list this one under. Another plugin's group is refused.",
    ),
}

// Which identity the host derives and sends, and it is not the whole vocabulary: `fleet` is missing on
// purpose. Fanning a manifest's route out over every paired node multiplies somebody else's network,
// rate limits and error noise on a declaration nobody reviewed per node, and the two scopes a loaded
// plugin actually needs — the open task and the routed project — are here. Core commands may still be
// fleet-scoped (`COMMAND_SCOPES`).
const loadedCommandScope = z
  .enum(['none', 'task', 'project', 'workspace', 'node'])
  .default('node')
  .describe(
    "Which identifier the host sends your route: `task`, `project`, and `workspace` send the open one's ID. A scope with nothing open offers no command.",
  )

export const actionCommandDescriptor = z.object({
  ...commandCommon,
  kind: z.literal('action').describe('A command that runs one action. Every command names its `kind`.'),
  action: contextFreeAction.describe('What the command does.'),
})

/** A parent. No action of its own: what it holds is the commands naming it as their `parentId`. */
export const groupCommandDescriptor = z.object({
  ...commandCommon,
  kind: z
    .literal('group')
    .describe('A command that holds the commands naming it as their `parentId`. It does nothing itself.'),
})

/**
 * A live query against one of this plugin's own routes.
 *
 * The host GETs `route` with `q` and the identifiers the declared scope owns, and it renders what
 * comes back as display facts (`CommandSearchItem`). A result cannot
 * choose what picking it does: `onSelect` is one static verb from a closed set, declared here and
 * reviewed with the rest of the manifest (docs/command-palette-and-shortcuts/palette-data.md § What the palette
 * refuses). The set is a command's own plus `navigate`, because a picked row is a selected row and a
 * project-scoped search already has its project.
 */
export const searchCommandDescriptor = z.object({
  ...commandCommon,
  kind: z
    .literal('search')
    .describe('A live search: the palette sends what the person types to your route and lists the results.'),
  scope: loadedCommandScope,
  // GET → { items: CommandSearchItem[] }, confined to this plugin's namespace by the refinement.
  route: pluginRoute.describe('A GET route sent `q` that answers `{ items }`. Each item is display text only.'),
  placeholder: z.string().min(1).max(120).optional().describe('Text in the empty search box.'),
  minQueryLength: z
    .number()
    .int()
    .min(0)
    .max(MAX_COMMAND_SEARCH_MIN_QUERY)
    .optional()
    .describe('How many characters the person types before the host asks your route.'),
  // Floored as well as capped: a declared 5 ms is a plugin spending a request on every keystroke.
  debounceMs: z
    .number()
    .int()
    .min(MIN_COMMAND_SEARCH_DEBOUNCE_MS)
    .max(MAX_COMMAND_SEARCH_DEBOUNCE_MS)
    .optional()
    .describe('How long the host waits after a keystroke before it asks your route.'),
  onSelect: selectedRowAction.describe("What picking a result does. A result can't choose its own action."),
})

/**
 * One line of text, submitted on Enter.
 *
 * The host POSTs `{ input, … }` to `route` and runs `onSuccess` only if the route answered. A failure
 * is the ordinary error envelope and keeps the reader's text where they typed it.
 */
export const inputCommandDescriptor = z.object({
  ...commandCommon,
  kind: z.literal('input').describe('One line of text, sent to your route when the person presses Enter.'),
  scope: loadedCommandScope,
  // POST { input, taskId?, projectId?, workspaceId? } → { ok: true, item?, message? }
  route: pluginRoute.describe(
    "A POST route sent `{ input }` that answers `{ ok: true }`. On an error the person's text stays where they typed it.",
  ),
  placeholder: z.string().min(1).max(120).optional().describe('Text in the empty input box.'),
  onSuccess: contextFreeAction.describe('What runs after your route answers.'),
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
  kind: z.literal('setting').describe('A choice from a fixed list, with its current value shown.'),
  scope: loadedCommandScope,
  // GET → { value }
  readRoute: pluginRoute.describe('A GET route that answers the current `{ value }`.'),
  // PUT { value, taskId?, projectId?, workspaceId? } → { value }
  writeRoute: pluginRoute.describe('A PUT route sent the picked `{ value }` that answers `{ value }`.'),
  // Two is the fewest that is a choice; a list long enough to need scrolling is a settings page
  // (`MIN_COMMAND_SETTING_OPTIONS`, `MAX_COMMAND_SETTING_OPTIONS`).
  options: z
    .array(commandSettingOptionSchema)
    .min(MIN_COMMAND_SETTING_OPTIONS)
    .max(MAX_COMMAND_SETTING_OPTIONS)
    .describe("The choices. A value your routes answer that isn't one of these is refused, not shown."),
})

export const commandDescriptor = z.discriminatedUnion('kind', [
  actionCommandDescriptor,
  groupCommandDescriptor,
  searchCommandDescriptor,
  inputCommandDescriptor,
  settingCommandDescriptor,
])

export const keybindingDescriptor = z.object({
  command: z.string().min(1).max(64).describe('The ID of a command in this manifest.'),
  defaultChord: z
    .string()
    .min(1)
    .max(64)
    .superRefine((value, ctx) => {
      if (!isNormalizedChord(value)) {
        ctx.addIssue({ code: 'custom', message: 'shortcut must use canonical meta+ctrl+alt+shift+key order' })
      } else if (!isPluginShortcutChord(value)) {
        ctx.addIssue({ code: 'custom', message: 'plugin shortcuts require meta, ctrl, or alt' })
      }
    })
    .describe(
      'The default chord, such as `meta+shift+k`, with modifiers in the order meta, ctrl, alt, shift. It needs meta, ctrl, or alt.',
    ),
  when: z
    .enum(['global', 'task', 'surface'])
    .describe('Where the chord works: anywhere, in a task, or in one of your panes.'),
  surface: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("With `when: 'surface'`, the ID of the pane the chord works in."),
})
