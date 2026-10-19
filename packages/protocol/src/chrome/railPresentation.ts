import { z } from 'zod'
import { artworkReferenceSchema } from '../content/artwork.ts'

// What a source's `railPresentation` route answers: live artwork and words for its rail button, drawn
// by the host while the source's own view is closed. Presentation only. Nothing here can change which
// source the button opens or what opening it does (docs/plugins/rail-presentation.md § Rail presentation).

/** The largest answer a client reads. A bigger one fails like any other unreadable answer. */
export const MAX_RAIL_PRESENTATION_BYTES = 32 * 1024

// Unknown keys are dropped rather than refused, so a plugin written for a later build still draws.
export const pluginRailPresentationSchema = z
  .object({
    artwork: artworkReferenceSchema.optional(),
    tooltip: z
      .object({
        // The host keeps the source's own label above it, so this never names the source.
        title: z.string().min(1).max(80).optional(),
        // Plain text. Line breaks are kept; anything that looks like markup is drawn as text.
        detail: z.string().min(1).max(1_024).optional(),
      })
      .optional(),
  })
  // `null` puts the button back to its static glyph and label.
  .nullable()

export type PluginRailPresentation = z.infer<typeof pluginRailPresentationSchema>
