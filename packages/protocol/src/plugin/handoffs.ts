import { z } from 'zod'
import { compileContentLinkPattern, CONTENT_LINK_PATTERN_MAX_LENGTH } from '../content/contentLinkPattern.ts'
import { pluginRoute } from './manifest/manifestFields.ts'

// Browser handoffs: a plugin's button on a website, which the browser extension draws and which hands
// the page's item to an Acorn task. A plugin declares the pages, the label, where the button goes, and
// one route on its own Node half that resolves the page into items. Everything else is the extension's:
// the button's markup and styling, when it appears, and what a click does. Loaded plugins declare these
// in their manifest and compiled plugins on `NodePlugin`; both pass `browserHandoffDescriptor`, so the
// extension can't tell them apart. docs/plugin-authoring/browser-handoffs.md owns the contract.
// Named for the action rather than the browser: `browser` is a plugin's ID.

// A page the button appears on, in the content-link grammar: https only, literal host (or `*.` one
// level), literal and `{capture}` path segments, matched without regular expressions.
const pagePattern = z
  .string()
  .min(1)
  .max(CONTENT_LINK_PATTERN_MAX_LENGTH)
  .superRefine((value, ctx) => {
    try {
      compileContentLinkPattern(value)
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
    }
  })

// A CSS selector the extension hands to `querySelector` and nothing else. Braces, semicolons, and
// angle-bracket markup can't appear in a selector the extension needs, so a rule or a tag is refused
// here rather than trusted to fail in the browser. `>` stays, because it is the child combinator.
const anchorSelector = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !/[{};<\u0000-\u001f]/.test(value), 'an anchor is a CSS selector, not a rule or markup')

export const browserHandoffDescriptor = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  // The button's text. Drawn as text, never as markup.
  label: z.string().trim().min(1).max(40),
  match: z.array(pagePattern).min(1).max(8),
  // Tried in order; the button goes at the end of the first element that matches. None matching is
  // normal after a site redesign: the sidebar still offers the handoff.
  anchors: z.array(anchorSelector).max(4).default([]),
  // POST BrowserHandoffResolveRequest → BrowserHandoffResolution, on this plugin's own route namespace.
  resolve: pluginRoute,
})
export type BrowserHandoffDescriptor = z.input<typeof browserHandoffDescriptor>

// One declared handoff as discovery advertises it: the descriptor, bound to the plugin that serves it.
export type BrowserHandoff = z.output<typeof browserHandoffDescriptor> & { pluginId: string }

// The Node's list of handoffs its active plugins declare. Device-only: it describes the plugin surface.
export const browserHandoffsRoute = '/v1/core/browser-handoffs'
export type BrowserHandoffsResponse = { handoffs: BrowserHandoff[] }

// What the resolve route receives: the page address, and the captures the caller matched from one of
// the handoff's own patterns. The plugin still reads its identity from these, not from page text.
export type BrowserHandoffResolveRequest = { url: string; captures: Record<string, string> }

// The largest resolution the extension's host reads, and the most proposed context one item carries.
export const BROWSER_HANDOFF_RESOLUTION_MAX_BYTES = 256 * 1024
const BROWSER_HANDOFF_CONTEXT_MAX_CHARS = 16_000

const rowId = z.string().min(1).max(128)

// The core task seed without its project, which the person chooses from `projects`. The same fields
// `POST /v1/core/tasks` takes, narrowed to the ones a provider can say about an external item.
const handoffTaskSeed = z.strictObject({
  origin: z.string().min(1).max(64),
  title: z.string().min(1).max(300).optional(),
  branch: z.string().min(1).max(250).optional(),
  pullNumber: z.int().positive().optional(),
  // Connection-stamped links, as the task route takes them. Core stamps the provider from the
  // connection and refuses one the caller doesn't own.
  links: z
    .array(
      z.strictObject({
        connectionId: rowId,
        identifier: z.string().min(1).max(300),
        ref: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(8)
    .optional(),
})

const handoffItem = z.strictObject({
  // The provider's own name for the item, such as `owner/repo#12`. Shown, and used to tell the person's
  // choice apart from the other candidates when a task is created.
  identifier: z.string().min(1).max(300),
  url: z
    .string()
    .url()
    .max(2048)
    .refine((value) => value.startsWith('https://'), 'an item address is https'),
  title: z.string().min(1).max(300),
  // The connection that resolved it. Two connections that can both see the item are two items.
  connection: z.strictObject({ id: rowId, label: z.string().max(200) }),
  // Projects the provider can tie the item to. A task is created only in one of these, which is what
  // keeps an item out of an unrelated project's task.
  projects: z.array(rowId).max(16),
  seed: handoffTaskSeed,
  // What the agent should read about the item. It goes into the person's draft for review, never
  // straight to an agent.
  context: z
    .strictObject({
      label: z.string().min(1).max(200),
      content: z.string().min(1).max(BROWSER_HANDOFF_CONTEXT_MAX_CHARS),
    })
    .optional(),
})

export const browserHandoffResolution = z.strictObject({ items: z.array(handoffItem).max(8) })
export type BrowserHandoffResolution = z.infer<typeof browserHandoffResolution>
export type BrowserHandoffItem = BrowserHandoffResolution['items'][number]

// The captures of the first pattern that matches `url`, or null when none does.
export function matchHandoffPage(handoff: Pick<BrowserHandoff, 'match'>, url: string): Record<string, string> | null {
  for (const pattern of handoff.match) {
    const captures = compileContentLinkPattern(pattern).match(url)
    if (captures) return { ...captures }
  }
  return null
}
