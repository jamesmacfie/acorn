import { z } from 'zod'
import { CORE_EXCLUSIVE_SLOTS } from '../chrome/extensionPoints.ts'

// This is user-editable data. Unknown top-level keys survive a write for forward compatibility,
// while known executable and custody fields are never accepted or interpreted.
export const devicePluginSourceSchema = z.union([
  z.strictObject({ github: z.string().min(1), tag: z.string().min(1).optional() }),
  z.strictObject({ npm: z.string().min(1), version: z.string().min(1).optional() }),
  z.strictObject({ url: z.url().startsWith('https://') }),
  z.strictObject({ path: z.string().min(1) }),
])

const preferenceId = z.string().min(1).max(160)
const forbiddenKeys = new Set([
  'commands', 'scripts', 'credentials', 'tokens', 'certificates', 'nodeEndpoints',
  'nodePreferences', 'pluginState', 'execute', 'shell',
])

export const deviceConfigSchema = z.looseObject({
  theme: z.string().min(1).max(128).optional(),
  themeLight: z.string().min(1).max(128).optional(),
  themeDark: z.string().min(1).max(128).optional(),
  themeFollowSystem: z.boolean().optional(),
  style: z.string().min(1).max(128).optional(),
  keybindings: z.record(preferenceId, z.union([z.string().max(64), z.null()])).optional(),
  railOrder: z.strictObject({ pinned: z.array(preferenceId), order: z.array(preferenceId), sources: z.array(preferenceId).optional() }).optional(),
  leftCollapsed: z.boolean().optional(),
  // `<pluginId>:<sourceId>` → shown. Only explicit choices live here; an absent entry reads the
  // source's own default.
  railVisibility: z.record(preferenceId, z.boolean()).optional(),
  exclusiveSlots: z.partialRecord(z.enum(CORE_EXCLUSIVE_SLOTS), preferenceId).optional(),
  plugins: z.array(z.strictObject({ id: preferenceId, source: devicePluginSourceSchema })).max(128).optional(),
}).superRefine((value, ctx) => {
  for (const key of Object.keys(value)) {
    if (forbiddenKeys.has(key) || key.startsWith('plugin:')) {
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is not device configuration` })
    }
  }
})

export type DeviceConfig = z.infer<typeof deviceConfigSchema>
export type DeviceConfigInput = z.input<typeof deviceConfigSchema>

export type DeviceConfigParse =
  | { ok: true; value: DeviceConfig }
  | { ok: false; message: string; line: number; column: number }

export function parseDeviceConfig(text: string): DeviceConfigParse {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reported = /line (\d+) column (\d+)/.exec(message)
    if (reported) return { ok: false, message, line: Number(reported[1]), column: Number(reported[2]) }
    const at = /position (\d+)/.exec(message)
    const position = at ? Number(at[1]) : 0
    const prefix = text.slice(0, position)
    const lines = prefix.split('\n')
    return { ok: false, message, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
  }
  const parsed = deviceConfigSchema.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data }
  const issue = parsed.error.issues[0]
  return { ok: false, message: `${issue?.path.join('.') || 'acorn.json'}: ${issue?.message ?? 'invalid configuration'}`, line: 1, column: 1 }
}
