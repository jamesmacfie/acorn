import { z } from 'zod'
import { compileContentLinkPattern, CONTENT_LINK_PATTERN_MAX_LENGTH } from '../../content/contentLinkPattern.ts'
import { isThemeColorValue, THEME_COLOR_VALUE_MAX, THEME_PALETTE_TOKENS } from '../../appearance/themeTokens.ts'
import { styleValueProblem } from '../../appearance/styleValues.ts'
import { refresh } from './chromeDescriptors.ts'
import { pluginRoute } from './manifestFields.ts'

export const attentionDescriptor = z.object({
  id: z.string().min(1).max(64),
  order: z.number().int().min(0).max(100_000).default(500),
  // GET → { items: PluginAttentionWireItem[] }, fetched per node like every attention source.
  items: pluginRoute,
  refresh,
})

export const nodeStatDescriptor = z.object({
  id: z.string().min(1).max(64),
  order: z.number().int().min(0).max(100_000).default(500),
  // Singular and plural, so a card reads "1 card stuck" rather than "1 cards stuck".
  label: z.tuple([z.string().min(1).max(60), z.string().min(1).max(60)]),
  // GET → PluginNodeStatValue
  data: pluginRoute,
  refresh,
})

const contentLinkPattern = z.string().min(1).max(CONTENT_LINK_PATTERN_MAX_LENGTH).superRefine((value, ctx) => {
  try {
    compileContentLinkPattern(value)
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
  }
})

// A renderer URL the host matches for this plugin, handing the matched value to the surface the entry
// names. The node confines it to a host-minted prefix, one per plugin id, so a manifest can't claim
// core's `/p/:projectId` and take over project navigation. `item` is required, because a route on this
// tier exists to address something inside a surface rather than to decide whether it appears.
export const clientRouteDescriptor = z.object({
  id: z.string().min(1).max(64),
  // The node's manifest refinement confines this path using the plugin id.
  path: z.string().min(1).max(256),
  // A `scope: 'project'` pane this same manifest declares, following the precedent
  // `contentLinks.openPane` and `chromeAction.openPane` set.
  surface: z.string().min(1).max(64),
  // A `:param` of `path`, and never `projectId`: that one is core's, and the host has already bound it.
  item: z.string().min(1).max(32),
  // Registration order on the Router, so a static path can be declared ahead of a parameter path that
  // would otherwise swallow it.
  order: z.number().int().min(0).max(100_000).default(500),
})

export const contentLinkDescriptor = z.object({
  id: z.string().min(1).max(64),
  match: contentLinkPattern.optional(),
  // A task-scoped pane this manifest declares, checked by the node. Optional, because the host can instead
  // open the plugin's reference panel for the matched item, which needs no task and no pane. Which of
  // the two a click gets is the clicking surface's call, not the manifest's.
  // See docs/plugins/client-half.md § Loaded plugins: the client half.
  openPane: z.string().min(1).max(64).optional(),
  openOverlay: z.string().min(1).max(64).optional(),
  item: z.string().min(1).max(32).optional(),
  presentations: z.array(z.enum(['route', 'refPanel', 'pane', 'overlay', 'external'])).min(1).max(5).optional(),
}).refine(value => !value.match || !!value.item, { message: 'URL targets need an item capture', path: ['item'] })

// An entry in the agent composer's "add Acorn context" list, served by two routes on the plugin's own
// node half (@acorn/protocol/agentContext.ts holds the response schemas).
//
// `revision?()` gets no manifest form: it's a synchronous number the composer reads while assembling
// its cache key, and a descriptor answers across a fetch. The invalidation ping the rest of the chrome
// rides covers the same freshness.
export const agentContextDescriptor = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(240).optional(),
  // GET ?taskId=&workspaceId= → AgentContextOption[]
  options: pluginRoute,
  // POST { taskId, workspaceId?, optionIds? } → snapshot bodies. The host binds `source` from the
  // plugin id, stamps the capture time, and measures the bytes itself.
  capture: pluginRoute,
})

// One batch-enrichment route, so a surface holding identifiers of this plugin's items can display them
// without importing this plugin. The host POSTs `{ identifiers }` and parses the answer against
// @acorn/protocol/refResolvers.ts. There's no single-identifier form: ask for an array of one.
// See docs/plugins/descriptors.md § Descriptors.
export const refResolverDescriptor = z.object({
  id: z.string().min(1).max(64),
  kind: z.string().min(1).max(64),
  // POST { identifiers } → PluginRefResolutionBody[]
  resolve: pluginRoute,
})

// A colour theme: a map of theme-token values the host validates, then generates a
// `:root[data-theme="plugin:<pluginId>:<id>"]` block from. No plugin-authored CSS reaches the shell.
// `z.strictObject` rather than `z.record` so every check happens at parse time.
// See docs/ui-design/appearance.md § Plugin themes for the token contract and what each group may declare.
export const themeDescriptor = z.object({
  // Namespaced by the host into `plugin:<pluginId>:<id>`. The alphabet is bounded because the result
  // is written into a CSS attribute selector.
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'theme id must be lower-case alphanumeric with dashes'),
  label: z.string().min(1).max(80),
  // Drives `--is-dark` and `--color-scheme`, which is everything that asks a theme whether it's
  // dark: the terminal and editor bridges read `--is-dark`, and the diff and Markdown fence rules
  // pick their syntax palette with `light-dark()`, which follows `--color-scheme`.
  dark: z.boolean().default(false),
  tokens: z.strictObject(Object.fromEntries(THEME_PALETTE_TOKENS.map((name) => [
    name,
    z.string().min(1).max(THEME_COLOR_VALUE_MAX).refine(
      isThemeColorValue,
      'must be a hex colour or a flat colour function — #1e1e2e, rgba(0, 0, 0, 0.42), oklch(0.7 0.15 250)',
    ),
  ]))),
})

export const styleDescriptor = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'style id must be lower-case alphanumeric with dashes'),
  label: z.string().min(1).max(80),
  description: z.string().max(240).optional(),
  tokens: z.record(z.string(), z.string()).superRefine((tokens, ctx) => {
    for (const [token, value] of Object.entries(tokens)) {
      const problem = styleValueProblem(token, value)
      if (problem) ctx.addIssue({ code: 'custom', path: [token], message: problem })
    }
  }),
})
