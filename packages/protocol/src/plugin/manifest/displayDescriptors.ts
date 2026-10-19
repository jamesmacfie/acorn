import { z } from 'zod'
import { checkDeclaredContentLinkPattern, CONTENT_LINK_PATTERN_MAX_LENGTH } from '../../content/contentLinkPattern.ts'
import { isThemeColorValue, THEME_COLOR_VALUE_MAX, THEME_PALETTE_TOKENS } from '../../appearance/themeTokens.ts'
import { styleValueProblem } from '../../appearance/styleValues.ts'
import { AGENT_CONTEXT_KEYWORD } from '../../agents/agentContext.ts'
import { refresh } from './chromeDescriptors.ts'
import { pluginRoute } from './manifestFields.ts'

export const attentionDescriptor = z.object({
  id: z.string().min(1).max(64).describe("The source's ID, unique in this manifest."),
  order: z
    .number()
    .int()
    .min(0)
    .max(100_000)
    .default(500)
    .describe("Where these items sort among other sources' items. Lower comes first."),
  // GET → { items: PluginAttentionWireItem[] }, fetched per node like every attention source.
  items: pluginRoute.describe(
    "A GET route that answers `{ items }`. The host asks each Node and sets each item's target itself.",
  ),
  refresh,
})

export const nodeStatDescriptor = z.object({
  id: z.string().min(1).max(64).describe("The stat's ID, unique in this manifest."),
  order: z
    .number()
    .int()
    .min(0)
    .max(100_000)
    .default(500)
    .describe('Where the stat sits on the card. Lower comes first.'),
  // Singular and plural, so a card reads "1 card stuck" rather than "1 cards stuck".
  label: z
    .tuple([z.string().min(1).max(60), z.string().min(1).max(60)])
    .describe(
      'The label in singular and plural, such as `["card stuck", "cards stuck"]`, so the card reads "1 card stuck".',
    ),
  // GET → PluginNodeStatValue
  data: pluginRoute.describe('A GET route that answers the number.'),
  refresh,
})

const contentLinkPattern = z
  .string()
  .min(1)
  .max(CONTENT_LINK_PATTERN_MAX_LENGTH)
  .superRefine((value, ctx) => {
    try {
      checkDeclaredContentLinkPattern(value)
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
    }
  })

// A renderer URL the host matches for this plugin, handing the matched value to the surface the entry
// names. The node confines it to a host-minted prefix, one per plugin id, so a manifest can't claim
// core's `/p/:projectId` and take over project navigation. `item` is required, because a route on this
// tier exists to address something inside a surface rather than to decide whether it appears.
export const clientRouteDescriptor = z.object({
  id: z.string().min(1).max(64).describe("The route's ID, unique in this manifest."),
  // The node's manifest refinement confines this path using the plugin id.
  path: z
    .string()
    .min(1)
    .max(256)
    .describe(
      'The app address, inside `/p/:projectId/x/<id>/`, with a `:param` for the item, such as `/p/:projectId/x/acme/issue/:issueId`.',
    ),
  // A `scope: 'project'` pane this same manifest declares, following the precedent
  // `contentLinks.openPane` and `chromeAction.openPane` set.
  surface: z.string().min(1).max(64).describe("The `scope: 'project'` pane in this manifest the address opens."),
  // A `:param` of `path`, and never `projectId`: that one is core's, and the host has already bound it.
  item: z
    .string()
    .min(1)
    .max(32)
    .describe("The `:param` in `path` that holds the item. It can't be `projectId`, which the host binds itself."),
  // Registration order on the Router, so a static path can be declared ahead of a parameter path that
  // would otherwise swallow it.
  order: z
    .number()
    .int()
    .min(0)
    .max(100_000)
    .default(500)
    .describe(
      'The order the host matches routes in. Put a fixed path before a `:param` path that would also match it.',
    ),
})

export const contentLinkDescriptor = z
  .object({
    id: z.string().min(1).max(64).describe("The link's ID, unique in this manifest."),
    match: contentLinkPattern
      .optional()
      .describe(
        "The URLs this link claims, such as `https://linear.app/{team}/issue/{id}`: `https`, a literal host or a code host's `{codeHost}`, and literal or `{capture}` path parts. Needs `item`.",
      ),
    // A task-scoped pane this manifest declares, checked by the node. Optional, because the host can instead
    // open the plugin's reference panel for the matched item, which needs no task and no pane. Which of
    // the two a click gets is the clicking surface's call, not the manifest's.
    // See docs/plugins/client-half.md § Loaded plugins: the client half.
    openPane: z.string().min(1).max(64).optional().describe('A task pane in this manifest the link can open.'),
    openOverlay: z.string().min(1).max(64).optional().describe('An overlay in this manifest the link can open.'),
    item: z
      .string()
      .min(1)
      .max(32)
      .optional()
      .describe('The `{capture}` in `match` that names the item. Required with `match`.'),
    presentations: z
      .array(z.enum(['route', 'refPanel', 'pane', 'overlay', 'external']))
      .min(1)
      .max(5)
      .optional()
      .describe('The ways the link may open. The surface the link is clicked in picks one.'),
  })
  .refine((value) => !value.match || !!value.item, { message: 'URL targets need an item capture', path: ['item'] })

// An entry in the agent composer's "add Acorn context" list, served by two routes on the plugin's own
// node half (`pluginAgentContextOptionsSchema` and `pluginAgentContextSnapshotsSchema` hold the
// response schemas).
//
// `revision?()` gets no manifest form: it's a synchronous number the composer reads while assembling
// its cache key, and a descriptor answers across a fetch. The invalidation ping the rest of the chrome
// rides covers the same freshness.
export const agentContextDescriptor = z.object({
  id: z.string().min(1).max(64).describe("The entry's ID, unique in this manifest."),
  label: z.string().min(1).max(80).describe("The entry's name in the composer's context list."),
  description: z.string().min(1).max(240).optional().describe('One line under the label.'),
  // The host qualifies a reserved or taken keyword as `<pluginId>-<keyword>` rather than refusing the
  // manifest, because two independent plugins can't coordinate names. Absent, the entry's id stands in.
  keyword: z
    .string()
    .min(1)
    .max(40)
    .regex(AGENT_CONTEXT_KEYWORD, 'keyword must be lower-case letters, digits, and dashes, starting with a letter')
    .optional()
    .describe('What follows `#` in the composer, such as `db` in `#db:monthly-revenue`. Defaults to the entry ID.'),
  itemless: z
    .boolean()
    .optional()
    .describe('No items to pick. The entry is referenced as a bare `#keyword` and captured with no `optionIds`.'),
  search: z
    .boolean()
    .optional()
    .describe('Send the typed text to `options` as `query`, so the route can search past what it would list.'),
  // GET ?taskId=&workspaceId=&query= → AgentContextOption[]
  options: pluginRoute.describe(
    'A GET route sent `taskId`, and `query` when `search` is set, that answers the options the person can pick.',
  ),
  // POST { taskId, workspaceId?, optionIds? } → snapshot bodies. The host binds `source` from the
  // plugin id, stamps the capture time, and measures the bytes itself.
  capture: pluginRoute.describe(
    'A POST route sent the picked `optionIds` that answers the text to attach. The host stamps the source and time itself.',
  ),
})

// One batch-enrichment route, so a surface holding identifiers of this plugin's items can display them
// without importing this plugin. The host POSTs `{ identifiers }` and parses the answer against
// `pluginRefResolutionsSchema`. There's no single-identifier form: ask for an array of one.
// See docs/plugins/descriptors.md § Descriptors.
export const refResolverDescriptor = z.object({
  id: z.string().min(1).max(64).describe("The resolver's ID, unique in this manifest."),
  kind: z.string().min(1).max(64).describe('The kind of item it labels, such as `issue`.'),
  // POST { identifiers } → PluginRefResolutionBody[]
  resolve: pluginRoute.describe(
    "A POST route sent `{ identifiers }` that answers a label for each. There's no single-item form: send an array of one.",
  ),
})

// A colour theme: a map of theme-token values the host validates, then generates a
// `:root[data-theme="plugin:<pluginId>:<id>"]` block from. No plugin-authored CSS reaches the shell.
// `z.strictObject` rather than `z.record` so every check happens at parse time.
// See docs/ui-design/appearance.md § Plugin themes for the token contract and what each group may declare.
export const themeDescriptor = z.object({
  // Namespaced by the host into `plugin:<pluginId>:<id>`. The alphabet is bounded because the result
  // is written into a CSS attribute selector.
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'theme id must be lower-case alphanumeric with dashes')
    .describe("The theme's ID, in lowercase letters, digits, and dashes. The host makes it `plugin:<pluginId>:<id>`."),
  label: z.string().min(1).max(80).describe("The theme's name in Settings > Appearance."),
  // Drives `--is-dark` and `--color-scheme`, which is everything that asks a theme whether it's
  // dark: the terminal and editor bridges read `--is-dark`, and the diff and Markdown fence rules
  // pick their syntax palette with `light-dark()`, which follows `--color-scheme`.
  dark: z
    .boolean()
    .default(false)
    .describe(
      "Whether the theme is dark. The host sets `--is-dark` and `--color-scheme` from it, so don't set those as tokens.",
    ),
  tokens: z
    .strictObject(
      Object.fromEntries(
        THEME_PALETTE_TOKENS.map((name) => [
          name,
          z
            .string()
            .min(1)
            .max(THEME_COLOR_VALUE_MAX)
            .refine(
              isThemeColorValue,
              'must be a hex colour or a flat colour function — #1e1e2e, rgba(0, 0, 0, 0.42), oklch(0.7 0.15 250)',
            )
            .describe(`The theme's \`${name}\` color.`),
        ]),
      ),
    )
    .describe(
      'A color for every palette token, and no others. Each is a hex color or a flat color function, such as `#1e1e2e` or `oklch(0.7 0.15 250)`.',
    ),
})

export const styleDescriptor = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'style id must be lower-case alphanumeric with dashes')
    .describe("The style pack's ID, in lowercase letters, digits, and dashes."),
  label: z.string().min(1).max(80).describe("The style pack's name in Settings > Appearance."),
  description: z.string().max(240).optional().describe('One line about how the style pack looks.'),
  tokens: z
    .record(z.string(), z.string())
    .superRefine((tokens, ctx) => {
      for (const [token, value] of Object.entries(tokens)) {
        const problem = styleValueProblem(token, value)
        if (problem) ctx.addIssue({ code: 'custom', path: [token], message: problem })
      }
    })
    .describe(
      "Style tokens and their values, such as radius and spacing. The host checks each one and refuses a value it can't use.",
    ),
})
