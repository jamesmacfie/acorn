import { z } from 'zod'
import { isValidProjectColor } from './projectColor.ts'

let catalogue: Promise<Set<string>> | undefined
/** Catalogue membership is needed when editing a glyph, outside the service's startup graph. */
export async function isWorkspaceIconName(name: string): Promise<boolean> {
  catalogue ??= import('./workspaceIconNames.ts').then((module) => new Set(module.default))
  return (await catalogue).has(name)
}
const color = z.string().refine(isValidProjectColor, 'Choose a preset or a six-digit hex colour.')
export const workspaceAppearanceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    version: z.literal(1), kind: z.literal('icon'),
    icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
    background: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('solid'), color }),
      z.strictObject({ kind: z.literal('gradient'), colors: z.array(color).min(2).max(4), angle: z.number().int().min(0).max(360) }),
    ]),
  }),
  z.strictObject({ version: z.literal(1), kind: z.literal('image'), imageId: z.string().regex(/^[a-f0-9]{64}$/) }),
])
export type WorkspaceAppearance = z.infer<typeof workspaceAppearanceSchema>

// Unsupported persisted versions remain stored and render as initials.
export function resolveWorkspaceAppearance(value: unknown): WorkspaceAppearance | null {
  const parsed = workspaceAppearanceSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const WORKSPACE_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024
export const WORKSPACE_IMAGE_PIXELS = 16_000_000
export const WORKSPACE_IMAGE_SIDE = 128
export const WORKSPACE_IMAGE_BYTES = 128 * 1024
export const workspaceImageCropSchema = z.strictObject({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1), size: z.number().positive().max(1),
})
export type WorkspaceImageCrop = z.infer<typeof workspaceImageCropSchema>

export const workspaceIconImageRoute = (imageId: string) => `/v1/core/workspaces/icon-images/${encodeURIComponent(imageId)}`
export const workspaceIconUploadRoute = (workspaceId: string) => `/v1/core/workspaces/${encodeURIComponent(workspaceId)}/icon-image`
