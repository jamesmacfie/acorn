import { z } from 'zod'
import {
  ARBITRATION_MODES, EXTENSION_POINT_KINDS, EXTENSION_POINT_LOCATIONS,
  HOOK_MODES, HOOK_PAYLOAD_TYPES, parseExtensionPointRef,
} from '../../extensionPoints.ts'
import { contextFreeAction, panelRegion, refresh } from './chromeDescriptors.ts'
import { pluginRoute } from './manifestFields.ts'

// ── Cooperative cross-plugin extension ────────────────────────────────────────────────────────────
//
// A declares the point it hosts, B declares the contribution, and the host fetches B's items from B's
// own node route and draws them inside the strip A's layout reserved. What crosses is a descriptor plus
// a verb from the closed set: never a component, never a callback, never code.
// See docs/plugins.md § Cooperative extension points and @acorn/protocol/extensionPoints.ts.

// What a hook's payload is declared to hold: field name to type, in the tree's prop vocabulary. Bounded
// because a payload is a decision's subject, not a document.
const hookPayloadShape = z.record(
  z.string().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'a payload field is a plain identifier'),
  z.enum(HOOK_PAYLOAD_TYPES),
)

export const extensionPointDescriptor = z.object({
  // Namespaced by the host into `<pluginId>:<id>`, the only name anyone else may use.
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'extension point id must be lower-case alphanumeric with dashes'),
  // What the owner is opening, in the owner's words. Shown at trust time to both sides.
  label: z.string().min(1).max(80),
  // Which of the five things a contributor may bring (@acorn/protocol/extensionPoints.ts). Defaults to
  // `rows`, so every manifest written before this field parses to the kind it meant.
  kind: z.enum(EXTENSION_POINT_KINDS).default('rows'),
  // `rows` and `rectangle`: where on the owner's surface, and which of the owner's surfaces. Required
  // for those two and refused for the rest by the node's manifest check: a hook has nothing to draw and
  // an annotation draws at a site the owner registered in code, so neither has a location to name.
  location: z.enum(EXTENSION_POINT_LOCATIONS).optional(),
  surface: z.string().min(1).max(64).optional(),
  // `pane.aside` only, checked in node-core/server/plugins/manifest.ts. The aside's contributor is the
  // user rather than another plugin, so it needs composition constraints rather than a route to read.
  // Absent means the defaults: this plugin's own sources, every view, four panels.
  panels: panelRegion.optional(),
  // `annotation` only, and required there: what the owner's items are keyed by. The host mints a
  // lookup string from these fields in this order, so the key set is the owner's and not whatever a
  // contributor's mark happens to carry.
  key: z.record(z.string().min(1).max(64), z.enum(['string', 'number'])).optional(),
  // `remote` and `rectangle`: who fills the box when more than one contributor could
  // (@acorn/protocol/extensionPoints.ts § ARBITRATION_MODES).
  mode: z.enum(ARBITRATION_MODES).optional(),
  // `replace` only: what the owner passes as the key when it opens the box, named so the developer
  // view and the settings picker can say what the arbitration is over ('mime', 'path', 'tool').
  selector: z.string().min(1).max(64).optional(),
  // `stack` only: how many contributors fit before the host draws a disclosure instead. The owner sets
  // it because it is the owner's screen, and each occupant costs a live subtree or an iframe.
  max: z.number().int().min(1).max(12).default(4),
  // `remote` and `rectangle`: the key values this point will ever pass, for the developer view and for
  // an author checking their `matches` against something. Advisory: a contributor whose `matches` fall
  // outside it simply never wins.
  accepts: z.array(z.string().min(1).max(128)).max(32).optional(),
  // `remote` only: what a contributor's tree may ask this point's owner to do. A closed vocabulary,
  // declared by the owner, because a contributor's props are data and it therefore has no other way to
  // reach back (docs/plugins.md § Cooperative extension points, "asking the owner").
  //
  // Names, not handlers. The owner binds a handler of the same name per `Slot` it draws, and the host
  // refuses a request that is not in both lists. An empty declaration is the default and means a
  // contributor may draw and nothing else, which is what every point shipped before this field meant.
  actions: z.array(z.string().min(1).max(64).regex(/^[a-z][a-zA-Z0-9]*$/, 'an action name is lower camel case')).max(8).optional(),
  // ── The hook fields (docs/plugins.md § Hooks) ──
  // Required for `kind: 'hook'` and refused elsewhere.
  payload: hookPayloadShape.optional(),
  // The subset of observe | transform | veto this owner permits. A handler asking for anything else
  // gets nothing.
  allows: z.array(z.enum(HOOK_MODES)).min(1).max(HOOK_MODES.length).optional(),
  // How long one handler may take. Beyond it a veto is treated as `onTimeout` says and everything else
  // is skipped, because a plugin that stalls must not brick a push.
  timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
  onTimeout: z.enum(['allow', 'deny']).default('allow'),
  // `priority` reads the handler's own number first, then install time; `install` ignores it. Ties are
  // stable either way.
  order: z.enum(['priority', 'install']).default('priority'),
  // Run every veto rather than stopping at the first, so the owner can show all the reasons at once.
  collect: z.boolean().default(false),
})

export const extensionDescriptor = z.object({
  id: z.string().min(1).max(64),
  // `<ownerPluginId>:<pointId>`. Naming the owner out loud is the disclosure: an owner reading this
  // manifest at install time sees which package this one reaches into.
  point: z.string().min(1).max(130),
  // The group heading the host draws above these rows, and the name the developer view and the
  // settings picker call this contribution. The host stamps the plugin id beside it, so this label
  // can't pass the contribution off as somebody else's.
  label: z.string().min(1).max(80),
  order: z.number().int().min(0).max(100_000).default(500),
  // Exactly one carrier, checked below. Which one is right depends on the owner's `kind`, which this
  // manifest cannot see, so the shape rule here is "name one way in" and the match against the point's
  // kind happens where both are visible (client-core/host/registries/extensionPoints/extensionPoints.ts).
  //
  //   items   `rows` and `annotation`: a route in this plugin's namespace (confined by the node).
  //   remote  a key of the object this plugin's bundle passed to `mountTree`.
  //   frame   an `inline` frame this manifest declares, drawn as a sibling of the owner's.
  //   route   `hook`: a route on this plugin's own namespace the host calls with the payload.
  items: pluginRoute.optional(),
  remote: z.string().min(1).max(64).optional(),
  frame: z.string().min(1).max(64).optional(),
  route: pluginRoute.optional(),
  // `remote` and `frame`: which key values this draws. Keyed rather than a predicate, because a
  // predicate is code and the arbitration has to be decidable by the host without running any.
  // Absent means "every key", which is the ordinary answer in a `stack` slot.
  matches: z.array(z.string().min(1).max(128)).min(1).max(64).optional(),
  // `remote` only: one of this manifest's own `overlay` frames, which this tree may ask the host to
  // present (docs/plugins.md § Companion overlays). A qualifier on the `remote` carrier rather than a
  // carrier of its own, so it must stay out of the exactly-one-carrier count below; adding it there
  // would reject every descriptor that uses it.
  //
  // Named here rather than passed at call time because it is the grant: a tree may open this one
  // overlay of its own plugin's and no other, and both sides are visible in the manifest at trust time.
  overlay: z.string().min(1).max(64).optional(),
  // `route` only: what this handler asks to do, and where it wants to sit in the chain.
  mode: z.enum(HOOK_MODES).optional(),
  priority: z.number().int().min(0).max(100_000).default(500),
  // Declared once here rather than per item, so the node can check it against this plugin's declared
  // surfaces at parse time. Narrow union, because the click site is inside another plugin's pane.
  onSelect: contextFreeAction.optional(),
  refresh,
}).superRefine((descriptor, ctx) => {
  // A `point` that isn't `<owner>:<point>` can never resolve: installs and does nothing, which looks
  // like it worked.
  if (!parseExtensionPointRef(descriptor.point)) {
    ctx.addIssue({ code: 'custom', path: ['point'], message: `'${descriptor.point}' is not an extension point reference — use '<pluginId>:<pointId>'` })
  }
  const carriers = (['items', 'remote', 'frame', 'route'] as const).filter((key) => descriptor[key] !== undefined)
  if (carriers.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['items'],
      message: `an extension names exactly one of items, remote, frame or route${carriers.length ? `, not ${carriers.join(' and ')}` : ''}`,
    })
  }
  // A mode belongs to a handler and nothing else. On any other carrier it would parse and never be
  // read, which is the failure this schema spends its length refusing.
  if (descriptor.mode && descriptor.route === undefined) {
    ctx.addIssue({ code: 'custom', path: ['mode'], message: 'mode is only valid on a hook handler, which names a route' })
  }
  if (descriptor.route !== undefined && !descriptor.mode) {
    ctx.addIssue({ code: 'custom', path: ['mode'], message: 'a hook handler says what it asks to do: observe, transform or veto' })
  }
  if (descriptor.matches && descriptor.remote === undefined && descriptor.frame === undefined) {
    ctx.addIssue({ code: 'custom', path: ['matches'], message: 'matches is only valid on a remote or frame contribution' })
  }
  // A companion overlay belongs to a tree. A rectangle already is a frame and can draw whatever it
  // wants inside itself; the rest of the carriers have no mounted UI to open one from.
  if (descriptor.overlay !== undefined && descriptor.remote === undefined) {
    ctx.addIssue({ code: 'custom', path: ['overlay'], message: 'overlay is only valid on a remote contribution' })
  }
})
