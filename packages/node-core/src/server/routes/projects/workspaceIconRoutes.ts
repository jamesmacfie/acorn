import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { respondError } from '../../respond'
import { broadcastWorkspaceChanged } from '../../notify'
import { workspaceImageCropSchema, WORKSPACE_IMAGE_UPLOAD_BYTES } from '@acorn/protocol/workspaceAppearance.ts'
import { normalizeWorkspaceImage, saveWorkspaceAppearance, workspaceImageId } from '../../projects/workspaceImages'

export const limitWorkspaceUpload = bodyLimit({
  maxSize: WORKSPACE_IMAGE_UPLOAD_BYTES + 16 * 1024,
  onError: (c) => respondError(c, 413, 'bad_request', ['Choose an image under 5 MiB.']),
})

export function readWorkspaceIcon(c: Context<AppEnv>) {
  const id = c.req.param('imageId')
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return respondError(c, 404, 'not_found')
  const image = getDb(c.env)
    .select()
    .from(schema.workspaceIconImages)
    .where(eq(schema.workspaceIconImages.id, id))
    .get()
  if (!image) return respondError(c, 404, 'not_found')
  return c.body(new Uint8Array(image.bytes), 200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'private, max-age=31536000, immutable',
  })
}

export async function uploadWorkspaceIcon(c: Context<AppEnv>) {
  const db = getDb(c.env)
  const id = c.req.param('id')
  if (!id) return respondError(c, 404, 'not_found')
  if (!db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, id)).get())
    return respondError(c, 404, 'not_found')
  try {
    const form = await c.req.formData()
    const file = form.get('image')
    const crop = workspaceImageCropSchema.safeParse(JSON.parse(String(form.get('crop'))))
    if (!(file instanceof File) || !crop.success)
      return respondError(c, 400, 'bad_request', ['Choose an image and a square crop.'])
    if (file.size > WORKSPACE_IMAGE_UPLOAD_BYTES)
      return respondError(c, 413, 'bad_request', ['Choose an image under 5 MiB.'])
    const bytes = await normalizeWorkspaceImage(new Uint8Array(await file.arrayBuffer()), crop.data)
    const appearance = { version: 1, kind: 'image', imageId: workspaceImageId(bytes) } as const
    if (!saveWorkspaceAppearance(db, id, appearance, bytes)) return respondError(c, 404, 'not_found')
    broadcastWorkspaceChanged({ workspaceId: id })
    return c.json({ appearance })
  } catch (error) {
    return respondError(c, 400, 'bad_request', [
      error instanceof Error ? error.message : 'Could not read this image. Choose another image.',
    ])
  }
}
