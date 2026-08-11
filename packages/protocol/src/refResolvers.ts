import { z } from 'zod'

// ── What a plugin's ref-resolver route may answer ──────────────────────────────────────────────────
//
// The enrichment half of a cross-plugin reference (docs/third-party/README.md § cross-plugin references). A surface
// holding identifiers of ANOTHER plugin's items — github's PR conversation citing `ENG-42` — asks the
// host, and the host POSTs `{ identifiers }` to the route the owning plugin declared in its manifest
// (`contributions.refResolvers`, node-core/main/pluginManifest.ts). It replaced a direct import of
// linear's `contract/issues.ts`, which was a cross-plugin import that stops working the day either
// side is a loaded package and could only ever resolve Linear.
//
// The vocabulary is deliberately tiny and should stay that way: a label and a state chip. Every field
// added here is a field EVERY provider's answer gets rendered with, which is the descriptor-tier slope
// (docs/third-party/README.md) of growing a contribution until it is a UI framework. Plain `z.object`,
// so a plugin answering more has the surplus stripped rather than passed through.
//
// `providerId` is ABSENT on purpose: the host stamps it from the plugin the route belongs to, the same
// rule that stops a content-link recogniser claiming another plugin's provider. A row that could name
// its own provider could put a stranger's items behind a stranger's reference panel.
export const MAX_REF_RESOLVE_IDENTIFIERS = 50

export const pluginRefResolutionsSchema = z.array(z.object({
  // The identifier the caller asked about, echoed back so the caller can index by it. A row naming
  // something that was not asked for is harmless — the reader keys by identifier and never iterates.
  identifier: z.string().min(1).max(200),
  // What to show: an issue title, a card name. One line, not a body.
  label: z.string().min(1).max(300),
  // The chip beside it. `kind` is the provider's own state vocabulary (`started`, `completed`), free
  // text because no two trackers agree on one; `color` is rendered as a CSS custom property and so is
  // length-bounded rather than parsed.
  state: z.object({
    name: z.string().min(1).max(80),
    color: z.string().min(1).max(32),
    kind: z.string().min(1).max(40),
  }).optional(),
  // The canonical external URL, for the fall-through when the item cannot be shown in-app.
  url: z.string().max(2048).optional(),
})).max(MAX_REF_RESOLVE_IDENTIFIERS)

export type PluginRefResolutionBody = z.infer<typeof pluginRefResolutionsSchema>[number]

/** A resolved reference with its provenance bound by the host. */
export type PluginRefResolution = PluginRefResolutionBody & { providerId: string }
