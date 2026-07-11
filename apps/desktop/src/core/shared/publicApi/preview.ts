import { z } from 'zod'

// Preview plugin public schemas (docs/public-api.md). Never exposes a raw webContents
// id, CDP handle, or bounds — those stay renderer-owned.

export const PreviewConfigurationSchema = z.strictObject({
  mode: z.enum(['url', 'port', 'script']).nullable(),
  value: z.string().nullable(),
  url: z.string().nullable(),
})

export const ResolveUrlResultSchema = z.strictObject({ url: z.string() })
export const SetUrlSchema = z.strictObject({ url: z.string().url().refine((u) => /^https?:\/\//.test(u), 'must be an http(s) URL') })
export const NavigationSchema = z.strictObject({ action: z.enum(['back', 'forward', 'reload', 'stop']) })
export const NavigationStateSchema = z.strictObject({
  url: z.string(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  loading: z.boolean(),
})
