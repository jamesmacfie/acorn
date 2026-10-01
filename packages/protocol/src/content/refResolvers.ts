import { z } from 'zod'

// What a plugin's ref-resolver route may answer. See docs/plugins.md § Loaded plugins: the client
// half (the `refResolvers` entry) for the full contract: why the vocabulary stays a label and a
// state chip, and why `providerId` is absent and host-stamped instead.
export const MAX_REF_RESOLVE_IDENTIFIERS = 50

export const pluginRefResolutionsSchema = z.array(z.object({
  // The identifier the caller asked about, echoed back so the caller can index by it. A row naming
  // something that was not asked for is harmless. The reader keys by identifier and never iterates.
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
