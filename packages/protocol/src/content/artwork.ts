import { z } from 'zod'
import { WORKSPACE_IMAGE_PIXELS, WORKSPACE_IMAGE_UPLOAD_BYTES } from '../appearance/workspaceAppearance.ts'

// A picture a plugin serves from its own Node routes, such as an album cover. The reference names
// immutable bytes: a changed picture needs a changed `revision` and a changed address, because
// clients share one read per Node, plugin, path, and revision. The host binds the Node and plugin from
// the registration or tree mount that drew the reference, so it carries neither.
// See docs/plugins/rail-presentation.md § Artwork bytes.

/** The ceilings an artwork answer must fit under. The workspace image limits, as upper bounds. */
export const ARTWORK_MAX_BYTES = WORKSPACE_IMAGE_UPLOAD_BYTES
export const ARTWORK_MAX_PIXELS = WORKSPACE_IMAGE_PIXELS

export const artworkReferenceSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(2_048)
    .describe('A GET route on your Node half that answers the image bytes, in your own route namespace.'),
  revision: z
    .string()
    .min(1)
    .max(128)
    .describe('Which bytes the path names. Change it, and the path, whenever the picture changes.'),
  alt: z.string().max(160).describe('What the picture shows, in words. Empty for a picture that adds nothing.'),
})
export type ArtworkReference = z.infer<typeof artworkReferenceSchema>

/** The kit's named sizes. The kit owns each one's dimensions; a plugin names a use, never a number. */
const ARTWORK_PRESETS = ['rail', 'thumbnail', 'detail'] as const
export type ArtworkPreset = (typeof ARTWORK_PRESETS)[number]

export const isArtworkPreset = (value: unknown): value is ArtworkPreset =>
  typeof value === 'string' && (ARTWORK_PRESETS as readonly string[]).includes(value)
