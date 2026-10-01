import { z } from 'zod'
import { boundedPluginToolSchema, PLUGIN_TOOL_OUTPUT_MAX_BYTES } from './runtimeContributions.ts'

export const PLUGIN_CLI_INPUT_MAX_BYTES = 64 * 1024
export const PLUGIN_CLI_OUTPUT_MAX_BYTES = PLUGIN_TOOL_OUTPUT_MAX_BYTES

// This deliberately uses the bounded JSON Schema language already accepted for agent tools.
// A command's input and output are both objects, so the host can validate them without
// guessing how a scalar should be projected into the CLI resource envelope.
export const pluginCliCommandDescriptorSchema = z.strictObject({
  name: z.string().regex(/^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,63}$/, 'command name must be lower-case kebab-case'),
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(300),
  effects: z.string().min(1).max(500).optional(),
  risk: z.enum(['read', 'write']),
  scope: z.enum(['node', 'workspace', 'project', 'task']),
  capability: z.string().min(1).max(64),
  inputSchema: boundedPluginToolSchema,
  outputSchema: boundedPluginToolSchema,
  route: z.strictObject({ method: z.literal('POST'), path: z.string().regex(/^\/cli\/[a-z][a-z0-9-]{0,63}$/, 'route must be a relative /cli/ command path') }),
}).superRefine((entry, ctx) => {
  if (entry.risk === 'write' && !entry.effects) ctx.addIssue({ code: 'custom', path: ['effects'], message: 'write commands must describe their effects' })
  if (entry.route.path !== `/cli/${entry.name}`) ctx.addIssue({ code: 'custom', path: ['route', 'path'], message: 'route path must match the command name' })
  const required = new Set((entry.inputSchema.required as string[] | undefined) ?? [])
  const properties = entry.inputSchema.properties as Record<string, unknown> | undefined
  for (const field of ['nodeId', ...(entry.scope === 'node' ? [] : entry.scope === 'workspace' ? ['workspaceId'] : entry.scope === 'project' ? ['projectId'] : ['taskId'])]) {
    if (!required.has(field) || (properties?.[field] as { type?: unknown } | undefined)?.type !== 'string') {
      ctx.addIssue({ code: 'custom', path: ['inputSchema', 'required'], message: `${field} must be a required string field` })
    }
  }
})

export type PluginCliCommandDescriptor = z.infer<typeof pluginCliCommandDescriptorSchema>

export function validatePluginCliValue(schema: Record<string, unknown>, value: unknown): { path: string; message: string }[] {
  let validator: z.ZodType
  try { validator = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]) }
  catch { return [{ path: '$', message: 'declared schema could not be compiled' }] }
  const result = validator.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => ({
    path: issue.path.length ? `$.${issue.path.join('.')}` : '$', message: issue.message,
  }))
}
