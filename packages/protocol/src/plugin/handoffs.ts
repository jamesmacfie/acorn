import { z } from 'zod'
import { compileContentLinkPattern, CONTENT_LINK_PATTERN_MAX_LENGTH } from '../content/contentLinkPattern.ts'
import { parseSiteAddress } from '../projects/siteAssociations.ts'
import { brandMark, pluginRoute } from './manifest/manifestFields.ts'

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
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .describe("The handoff's ID, in lowercase letters, digits, and dashes."),
  // The button's text. Drawn as text, never as markup.
  label: z.string().trim().min(1).max(40).describe("The button's text, drawn as plain text."),
  match: z
    .array(pagePattern)
    .min(1)
    .max(8)
    .describe(
      'The pages the button appears on, such as `https://github.com/{owner}/{repo}/pull/{number}`: `https`, a literal host, and literal or `{capture}` path parts.',
    ),
  // Tried in order; the button goes at the end of the first element that matches. None matching is
  // normal after a site redesign: the sidebar still offers the handoff.
  anchors: z
    .array(anchorSelector)
    .max(4)
    .default([])
    .describe(
      'CSS selectors tried in order. The button goes at the end of the first element found. When none match, the sidebar still offers the handoff.',
    ),
  // POST BrowserHandoffResolveRequest → BrowserHandoffResolution, on this plugin's own route namespace.
  resolve: pluginRoute.describe(
    "A POST route on your Node half, sent `{ url, captures }`, that answers the page's items.",
  ),
})
export type BrowserHandoffDescriptor = z.input<typeof browserHandoffDescriptor>

// One declared handoff as discovery advertises it: the descriptor, bound to the plugin that serves it.
export type BrowserHandoff = z.output<typeof browserHandoffDescriptor> & { pluginId: string }

// A plugin's logo, from its manifest's `icon`, which the sidebar registers as `brand:<pluginId>`.
export const pluginIcon = brandMark.extend({ pluginId: z.string().min(1).max(64) })
export type PluginIcon = z.infer<typeof pluginIcon>

// The Node's list of handoffs its active plugins declare, and the task address route and sidebar panel
// each declares, with the logo of each plugin that declares a handoff or a panel. The sidebar can't load
// a plugin's client, which is where the desktop gets the logo. Device-only: it describes the plugin surface.
export const browserHandoffsRoute = '/v1/core/browser-handoffs'
export type BrowserHandoffsResponse = {
  handoffs: BrowserHandoff[]
  taskAddresses: TaskAddressesRoute[]
  panels: BrowserPanel[]
  icons: PluginIcon[]
}

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

// Task addresses: a plugin's word that a task's app answers at an exact origin right now, such as a
// local stack it started. A plugin declares one GET route on its own Node half as
// `contributions.taskAddresses`; the browser's native host reads it beside the Node's task list, and
// the extension matches pages against the result in the browser, so no page address goes to the Node.
// docs/plugin-authoring/browser-handoffs.md owns the contract.
export type TaskAddressesRoute = { pluginId: string; route: string }

// A loopback host: `localhost`, a `*.localhost` name, `127.x.x.x`, or `[::1]`. A task's app runs on the
// person's own machine, and a plugin that could name any host could tie every page of someone else's
// site, such as github.com, to one of its tasks.
const isLoopback = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '[::1]' ||
  /^127(\.\d{1,3}){3}$/.test(hostname)

// An exact loopback origin, scheme and port included, in the form a browser reports it, as project
// sites store theirs. No path, so the address covers the app and nothing else on the host's other ports.
const exactOrigin = z
  .string()
  .max(300)
  .refine((value) => {
    const parsed = parseSiteAddress(value)
    return (
      parsed.ok && parsed.site.origin === value && parsed.site.pathPrefix === '/' && isLoopback(new URL(value).hostname)
    )
  }, 'an address is an exact http or https origin on a loopback host with no path, such as https://app.localhost:5104')

// The annotation severities: `info` is a healthy state, `warn` one to check, `danger` a failure.
const severity = z.enum(['info', 'warn', 'danger'])

export const taskAddressList = z.strictObject({
  addresses: z
    .array(
      z.strictObject({
        taskId: rowId,
        origin: exactOrigin,
        // What answers at the address and its state, read together as one line: "Runn stack running".
        label: z.string().trim().min(1).max(40),
        state: z.string().trim().min(1).max(40),
        severity,
      }),
    )
    .max(64),
})
export type TaskAddressList = z.infer<typeof taskAddressList>
export const TASK_ADDRESSES_MAX_BYTES = 64 * 1024

// Browser panels: a read-only view a plugin adds to the extension's sidebar for one task, such as Runn's
// stack. A plugin declares one GET route on its own Node half as `contributions.browserPanel`; the
// browser's native host calls it with the sidebar's task and holds the answer to `browserPanelView`.
// The extension draws the view from the fixed blocks below, as text, so no plugin code runs in the
// browser. docs/plugin-authoring/browser-panel.md owns the contract.
export const browserPanelDescriptor = z.object({
  // The nav item's label, such as "Runn".
  label: z.string().trim().min(1).max(40).describe("The panel's name in the sidebar's navigation."),
  // A Lucide icon name for the nav item, or `brand:<pluginId>` for the manifest's logo, which the
  // sidebar registers from the discovery read's `icons`.
  glyph: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("A Lucide icon name for the navigation item, or `brand:<id>` for the plugin's logo."),
  // A task-scoped pane in the same manifest, which Open in Acorn opens.
  pane: z.string().min(1).max(64).optional().describe('A task pane in this manifest that **Open in Acorn** opens.'),
  // GET ?taskId=<id>[&source=<id>] → BrowserPanelView, or 404 for a task with no panel.
  route: pluginRoute.describe(
    "A GET route sent `taskId` that answers the panel's blocks, or 404 for a task with no panel.",
  ),
})
export type BrowserPanelDescriptor = z.output<typeof browserPanelDescriptor>
export type BrowserPanel = BrowserPanelDescriptor & { pluginId: string }

// A log source the person picks, sent back to the plugin's route as `source`.
export const browserPanelSourceId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/)

const panelText = z.string().min(1).max(40)

// A panel adds `pending` for a state on its way to healthy, such as a service still starting.
const panelSeverity = z.enum([...severity.options, 'pending'])

// Strict throughout: a field or block kind this build doesn't know refuses the whole view, so a new
// kind ships in Acorn before any plugin sends it.
const panelBlock = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('status'),
    label: panelText,
    state: panelText,
    severity: panelSeverity,
    detail: z.string().max(2_000).optional(),
  }),
  z.strictObject({
    kind: z.literal('links'),
    title: panelText,
    // Any scheme, such as a database address. The extension opens only http and https, and copies the rest.
    // `ready: false` is an address that isn't answering yet, which the extension shows but doesn't open.
    links: z
      .array(z.strictObject({ label: panelText, url: z.string().min(1).max(2_048), ready: z.boolean().optional() }))
      .max(16),
  }),
  z.strictObject({
    kind: z.literal('rows'),
    title: panelText,
    rows: z
      .array(z.strictObject({ label: z.string().min(1).max(80), state: panelText, severity: panelSeverity }))
      .max(64),
  }),
  z.strictObject({
    kind: z.literal('logs'),
    title: panelText,
    sources: z.array(z.strictObject({ id: browserPanelSourceId, label: panelText })).max(32),
    // The source `lines` came from, or null when there is none to show.
    source: browserPanelSourceId.nullable(),
    lines: z.array(z.string().max(1_000)).max(200),
  }),
])

export const browserPanelView = z.strictObject({ blocks: z.array(panelBlock).max(12) })
export type BrowserPanelView = z.infer<typeof browserPanelView>
export type BrowserPanelBlock = BrowserPanelView['blocks'][number]
export const BROWSER_PANEL_MAX_BYTES = 512 * 1024
