import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { eq, sql } from 'drizzle-orm'
import {
  WORKSPACE_IMAGE_BYTES,
  WORKSPACE_IMAGE_PIXELS,
  WORKSPACE_IMAGE_SIDE,
  WORKSPACE_IMAGE_UPLOAD_BYTES,
  type WorkspaceAppearance,
  type WorkspaceImageCrop,
} from '@acorn/protocol/workspaceAppearance.ts'
import { schema, type AppDatabase } from '../db'

let decoding = 0

/** Decode only raster formats, bounded before pixel work. Originals never reach storage. */
export async function normalizeWorkspaceImage(input: Uint8Array, crop: WorkspaceImageCrop): Promise<Buffer> {
  if (!input.length || input.length > WORKSPACE_IMAGE_UPLOAD_BYTES) throw new Error('Choose an image under 5 MiB.')
  if (decoding >= 2) throw new Error('Two images are being processed. Try again shortly.')
  decoding++
  try {
    // Restrict by signature before invoking a decoder, including SVG's external-resource parser.
    const bytes = Buffer.from(input)
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    if (!png && !jpeg && !webp) throw new Error('Choose a PNG, JPEG, or WebP image.')
    const image = sharp(bytes, {
      limitInputPixels: WORKSPACE_IMAGE_PIXELS,
      failOn: 'warning',
      autoOrient: true,
    }).timeout({ seconds: 5 })
    const meta = await image.metadata()
    if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) !== 1)
      throw new Error('Choose a static PNG, JPEG, or WebP image.')
    const width = meta.autoOrient?.width ?? meta.width
    const height = meta.autoOrient?.height ?? meta.height
    if (!width || !height || width * height > WORKSPACE_IMAGE_PIXELS)
      throw new Error('Choose an image with at most 16 million pixels.')
    const side = Math.max(1, Math.round(crop.size * Math.min(width, height)))
    const left = Math.round((width - side) * crop.x)
    const top = Math.round((height - side) * crop.y)
    const thumbnail = await image
      .extract({ left, top, width: side, height: side })
      .resize(WORKSPACE_IMAGE_SIDE, WORKSPACE_IMAGE_SIDE)
      .png()
      .toBuffer()
    if (thumbnail.length > WORKSPACE_IMAGE_BYTES) throw new Error('The thumbnail is too large. Choose another image.')
    return thumbnail
  } finally {
    decoding--
  }
}

/** Synchronous transaction after normalization: no reference can outlive its bytes. */
export function saveWorkspaceAppearance(
  db: AppDatabase,
  id: string,
  appearance: WorkspaceAppearance | null,
  bytes?: Buffer,
): boolean {
  return db.transaction((tx) => {
    if (!tx.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, id)).get())
      return false
    if (appearance?.kind === 'image') {
      if (bytes)
        tx.insert(schema.workspaceIconImages).values({ id: appearance.imageId, bytes }).onConflictDoNothing().run()
      if (
        !tx
          .select({ id: schema.workspaceIconImages.id })
          .from(schema.workspaceIconImages)
          .where(eq(schema.workspaceIconImages.id, appearance.imageId))
          .get()
      ) {
        throw new Error('This workspace image is unavailable. Upload it again.')
      }
    }
    tx.update(schema.workspaces).set({ appearance, updatedAt: Date.now() }).where(eq(schema.workspaces.id, id)).run()
    pruneWorkspaceImages(tx)
    return true
  })
}

export function pruneWorkspaceImages(db: Pick<AppDatabase, 'delete'>): void {
  db.delete(schema.workspaceIconImages)
    .where(sql`NOT EXISTS (
    SELECT 1 FROM workspaces WHERE json_extract(workspaces.appearance, '$.kind') = 'image'
      AND json_extract(workspaces.appearance, '$.imageId') = ${schema.workspaceIconImages.id}
  )`)
    .run()
}

export const workspaceImageId = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
