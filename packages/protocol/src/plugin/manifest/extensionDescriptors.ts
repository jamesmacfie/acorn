import { z } from 'zod'
import {
  ARBITRATION_MODES,
  DETAIL_REGIONS,
  DISCLOSED_NODE_POINTS,
  EXTENSION_POINT_KINDS,
  EXTENSION_POINT_LOCATIONS,
  HOOK_MODES,
  HOOK_PAYLOAD_TYPES,
  MAX_DETAIL_MOUNTS,
  parseExtensionPointRef,
} from '../../chrome/extensionPoints.ts'
import { contextFreeAction, panelRegion, refresh } from './chromeDescriptors.ts'
import { pluginRoute } from './manifestFields.ts'

// ── Cooperative cross-plugin extension ────────────────────────────────────────────────────────────
//
// A declares the point it hosts, B declares the contribution, and the host fetches B's items from B's
// own node route and draws them inside the strip A's layout reserved. What crosses is a descriptor plus
// a verb from the closed set: never a component, never a callback, never code.
// See docs/plugins/cooperative-extension-points.md § Cooperative extension points and the header of
// chrome/extensionPoints.ts.

// What a hook's payload is declared to hold: field name to type, in the tree's prop vocabulary. Bounded
// because a payload is a decision's subject, not a document.
const hookPayloadShape = z
  .record(
    z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'a payload field is a plain identifier'),
    z.enum(HOOK_PAYLOAD_TYPES),
  )
  .describe('The hook\'s payload fields and their types, such as `{ "branch": "string" }`.')

export const extensionPointDescriptor = z.object({
  // Namespaced by the host into `<pluginId>:<id>`, the only name anyone else may use.
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'extension point id must be lower-case alphanumeric with dashes')
    .describe("The point's ID, in lowercase letters, digits, and dashes. Others name it as `<yourPluginId>:<id>`."),
  // What the owner is opening, in the owner's words. Shown at trust time to both sides.
  label: z.string().min(1).max(80).describe("What you're opening, in your words. Both plugins' trust prompts show it."),
  // Which of the five things a contributor may bring (`EXTENSION_POINT_KINDS`). Defaults to `rows`,
  // which is what a manifest without the field means.
  kind: z
    .enum(EXTENSION_POINT_KINDS)
    .default('rows')
    .describe(
      'What a contributor brings: `rows` from a route, `annotation` marks, a `remote` tree, a `rectangle` frame, or a `hook` handler.',
    ),
  // `rows` and `rectangle`: where on the owner's surface, and which of the owner's surfaces. Required
  // for those two and refused for the rest by the node's manifest check: a hook has nothing to draw and
  // an annotation draws at a site the owner registered in code, so neither has a location to name.
  location: z
    .enum(EXTENSION_POINT_LOCATIONS)
    .optional()
    .describe(
      'Where on your surface the host draws the point. Required for `rows` and `rectangle`, refused for the other kinds.',
    ),
  surface: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Which of your own panes the point sits on, for `rows` and `rectangle`.'),
  // `pane.aside` only, checked by node-core's `pluginManifestSchema`. The aside's contributor is the
  // user rather than another plugin, so it needs composition constraints rather than a route to read.
  // Absent means the defaults: this plugin's own sources, every view, four panels.
  panels: panelRegion
    .optional()
    .describe(
      'For `pane.aside` only: what the person may put in the dashboard region. Leave it out for your own sources, every view, and four panels.',
    ),
  // `annotation` only, and required there: what the owner's items are keyed by. The host mints a
  // lookup string from these fields in this order, so the key set is the owner's and not whatever a
  // contributor's mark happens to carry.
  key: z
    .record(z.string().min(1).max(64), z.enum(['string', 'number']))
    .optional()
    .describe("For `annotation`, and required there: the fields your items are keyed by, and each one's type."),
  // `remote` and `rectangle`: who fills the box when more than one contributor could
  // (`ARBITRATION_MODES`).
  mode: z
    .enum(ARBITRATION_MODES)
    .optional()
    .describe('For `remote` and `rectangle`: `replace` draws one contributor, and `stack` draws several, up to `max`.'),
  // `replace` only: what the owner passes as the key when it opens the box, named so the developer
  // view and the settings picker can say what the arbitration is over ('mime', 'path', 'tool').
  selector: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'For `replace`: what the key you pass names, such as `mime` or `path`, so Settings can say what the person picks between.',
    ),
  // `stack` only: how many contributors fit before the host draws a disclosure instead. The owner sets
  // it because it is the owner's screen, and each occupant costs a live subtree or an iframe.
  max: z
    .number()
    .int()
    .min(1)
    .max(12)
    .default(4)
    .describe('For `stack`: how many contributors draw before the host folds the rest away.'),
  // `remote` and `rectangle`: the key values this point will ever pass, for the developer view and for
  // an author checking their `matches` against something. Advisory: a contributor whose `matches` fall
  // outside it simply never wins.
  accepts: z
    .array(z.string().min(1).max(128))
    .max(32)
    .optional()
    .describe(
      "For `remote` and `rectangle`: the key values you'll pass, as a guide for contributors' `matches`. It's advisory.",
    ),
  // `remote` only: what a contributor's tree may ask this point's owner to do. A closed vocabulary,
  // declared by the owner, because a contributor's props are data and it therefore has no other way to
  // reach back (docs/plugins/cooperative-extension-points.md § Cooperative extension points, "asking the owner").
  //
  // Names, not handlers. The owner binds a handler of the same name per `Slot` it draws, and the host
  // refuses a request that is not in both lists. An empty declaration is the default and means a
  // contributor may draw and nothing else.
  actions: z
    .array(
      z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z][a-zA-Z0-9]*$/, 'an action name is lower camel case'),
    )
    .max(8)
    .optional()
    .describe(
      "For `remote`: action names a contributor's tree may ask you to run with `mount.host.invoke`. You bind a handler for each in your own tree.",
    ),
  // `remote` only: where the host mounts this point outside the owner's own tree, above or below one
  // of this manifest's project panes or reference panels (docs/plugins/detail-regions.md). Absent
  // means the owner draws the point itself, as a compiled owner does.
  mounts: z
    .array(
      z.object({
        surface: z.string().min(1).max(64).describe('One of your project panes or reference panels.'),
        region: z.enum(DETAIL_REGIONS).describe('Above the view, `header`, or below it, `footer`.'),
      }),
    )
    .min(1)
    .max(MAX_DETAIL_MOUNTS)
    .optional()
    .describe(
      'For `remote`: where the host draws the point outside your tree, above or below your views, so you write no `Slot`.',
    ),
  // ── The hook fields (docs/plugins/hooks.md § Hooks) ──
  // Required for `kind: 'hook'` and refused elsewhere.
  payload: hookPayloadShape
    .optional()
    .describe('For `hook`, and required there: the fields a handler receives, and their types.'),
  // The subset of `HOOK_MODES` this owner permits. A handler asking for anything else gets nothing.
  allows: z
    .array(z.enum(HOOK_MODES))
    .min(1)
    .max(HOOK_MODES.length)
    .optional()
    .describe('For `hook`: the modes a handler may ask for. A handler asking for another gets nothing.'),
  // How long one handler may take. Beyond it a veto is treated as `onTimeout` says and everything else
  // is skipped, because a plugin that stalls must not brick a push.
  timeoutMs: z
    .number()
    .int()
    .min(100)
    .max(30_000)
    .default(5_000)
    .describe('For `hook`: how long one handler may take, in milliseconds.'),
  onTimeout: z
    .enum(['allow', 'deny'])
    .default('allow')
    .describe('For `hook`: what a veto handler that runs out of time counts as.'),
  // `priority` reads the handler's own number first, then install time; `install` ignores it. Ties are
  // stable either way.
  order: z
    .enum(['priority', 'install'])
    .default('priority')
    .describe('For `hook`: run handlers by their `priority`, then install time, or by install time alone.'),
  // Run every veto rather than stopping at the first, so the owner can show all the reasons at once.
  collect: z
    .boolean()
    .default(false)
    .describe('For `hook`: run every veto handler instead of stopping at the first, so you can show every reason.'),
})

export const extensionDescriptor = z
  .object({
    id: z.string().min(1).max(64).describe("The contribution's ID, unique in this manifest."),
    // `<ownerPluginId>:<pointId>`. Naming the owner out loud is the disclosure: an owner reading this
    // manifest at install time sees which package this one reaches into.
    point: z
      .string()
      .min(1)
      .max(130)
      .describe(
        "The point you fill, as `<ownerPluginId>:<pointId>`. If the owner isn't installed, nothing shows, with no error.",
      ),
    // The group heading the host draws above these rows, and the name the developer view and the
    // settings picker call this contribution. The host stamps the plugin id beside it, so this label
    // can't pass the contribution off as somebody else's.
    label: z
      .string()
      .min(1)
      .max(80)
      .describe(
        "The heading above your rows, and your contribution's name in Settings. The host shows your plugin's name beside it.",
      ),
    order: z
      .number()
      .int()
      .min(0)
      .max(100_000)
      .default(500)
      .describe("Where your rows sit among other contributors'. Lower comes first."),
    // Exactly one carrier, checked below. Which one is right depends on the owner's `kind`, which this
    // manifest cannot see, so the shape rule here is "name one way in" and the match against the point's
    // kind happens where both are visible (client-core's `carrierFits`).
    //
    //   items   `rows` and `annotation`: a route in this plugin's namespace (confined by the node).
    //   remote  a key of the object this plugin's bundle passed to `mountTree`.
    //   frame   an `inline` frame this manifest declares, drawn as a sibling of the owner's.
    //   route   `hook`: a route on this plugin's own namespace the host calls with the payload.
    items: pluginRoute
      .optional()
      .describe(
        'For a `rows` or `annotation` point: a route on your Node half that answers the rows or marks. Name exactly one of `items`, `remote`, `frame`, and `route`.',
      ),
    remote: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('For a `remote` point: the `mountTree` entry in your client bundle that draws your tree.'),
    frame: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('For a `rectangle` point: an `inline` frame in this manifest.'),
    route: pluginRoute
      .optional()
      .describe('For a `hook` point: a route on your Node half the host calls with the payload. Needs `mode`.'),
    // `remote` and `frame`: which key values this draws. Keyed rather than a predicate, because a
    // predicate is code and the arbitration has to be decidable by the host without running any.
    // Absent means "every key", which is the ordinary answer in a `stack` slot.
    matches: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(64)
      .optional()
      .describe(
        'For `remote` and `frame`: the keys you draw for, exactly or as `prefix*` or `*suffix`. Leave it out to draw for every key.',
      ),
    // `remote` only: one of this manifest's own `overlay` frames, which this tree may ask the host to
    // present (docs/plugins/remote-points.md § Companion overlays). A qualifier on the `remote` carrier rather than a
    // carrier of its own, so it must stay out of the exactly-one-carrier count below; adding it there
    // would reject every descriptor that uses it.
    //
    // Named here rather than passed at call time because it is the grant: a tree may open this one
    // overlay of its own plugin's and no other, and both sides are visible in the manifest at trust time.
    overlay: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('For `remote`: one of your own overlays your tree may ask the host to open.'),
    // `route` only: what this handler asks to do, and where it wants to sit in the chain.
    mode: z
      .enum(HOOK_MODES)
      .optional()
      .describe(
        'For `route`, and required there: what the handler asks to do: `observe`, `transform`, `veto`, or `ask`.',
      ),
    priority: z
      .number()
      .int()
      .min(0)
      .max(100_000)
      .default(500)
      .describe('For a hook handler: where it runs in the chain, when the owner orders by priority. Lower runs first.'),
    // Declared once here rather than per item, so the node can check it against this plugin's declared
    // surfaces at parse time. Narrow union, because the click site is inside another plugin's pane.
    onSelect: contextFreeAction.optional().describe("For `items` rows: what picking a row does. It gets the row's ID."),
    refresh,
  })
  .superRefine((descriptor, ctx) => {
    // A `point` that isn't `<owner>:<point>` can never resolve: installs and does nothing, which looks
    // like it worked.
    if (!parseExtensionPointRef(descriptor.point)) {
      ctx.addIssue({
        code: 'custom',
        path: ['point'],
        message: `'${descriptor.point}' is not an extension point reference — use '<pluginId>:<pointId>'`,
      })
    }
    const carriers = (['items', 'remote', 'frame', 'route'] as const).filter((key) => descriptor[key] !== undefined)
    // A disclosed node point is filed from the node through `ctx.extensionPoints.handle`. The entry here is
    // the declaration the trust prompt reads, so it names no carrier.
    if (Object.hasOwn(DISCLOSED_NODE_POINTS, descriptor.point)) {
      if (carriers.length) {
        ctx.addIssue({
          code: 'custom',
          path: [carriers[0]!],
          message: `'${descriptor.point}' is filled from the node through ctx.extensionPoints.handle, so it names no ${carriers.join(' or ')}`,
        })
      }
    } else if (carriers.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: `an extension names exactly one of items, remote, frame or route${carriers.length ? `, not ${carriers.join(' and ')}` : ''}`,
      })
    }
    // A mode belongs to a handler and nothing else. On any other carrier it would parse and never be
    // read, which is the failure this schema spends its length refusing.
    if (descriptor.mode && descriptor.route === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'mode is only valid on a hook handler, which names a route',
      })
    }
    if (descriptor.route !== undefined && !descriptor.mode) {
      ctx.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'a hook handler says what it asks to do: observe, transform or veto',
      })
    }
    if (descriptor.matches && descriptor.remote === undefined && descriptor.frame === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['matches'],
        message: 'matches is only valid on a remote or frame contribution',
      })
    }
    // A companion overlay belongs to a tree. A rectangle already is a frame and can draw whatever it
    // wants inside itself; the rest of the carriers have no mounted UI to open one from.
    if (descriptor.overlay !== undefined && descriptor.remote === undefined) {
      ctx.addIssue({ code: 'custom', path: ['overlay'], message: 'overlay is only valid on a remote contribution' })
    }
  })
