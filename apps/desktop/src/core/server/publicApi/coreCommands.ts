import { z } from 'zod'
import { PublicApiError } from '../../shared/publicApi/errors'
import {
  CommandDescriptorSchema,
  CommandInvocationOuterSchema,
  CommandListQuerySchema,
  CommandResultSchema,
  CoreCommandInputs,
  WindowPresentationSchema,
  WindowSummarySchema,
} from '../../shared/publicApi/commands'
import { defineCommand, defineEndpoint, type CommandCategory, type CommandContribution, type PluginApiContribution, type PublicOperationContext } from './defineEndpoint'
import type { RegistrySnapshot } from './registry'

// Core typed commands + discovery/invocation (docs/public-api.md). The registry
// + discovery is fully server-side; invoking a presentation ('renderer') command needs the live UI
// control broker. Until the broker + renderer registration land, renderer commands return
// 409 ui_unavailable — discovery still works and the contract is stable.

// The broker crosses to the live renderer; injected when available.
export interface UiControlBroker {
  invoke(input: {
    commandId: string
    input: unknown
    windowId?: string
    expectedRevision?: number
  }): Promise<z.infer<typeof CommandResultSchema>>
  snapshots(): { windowId: string; primary: boolean; snapshot: unknown }[]
  snapshot(windowId?: string): unknown | null
  readonly rendererConnected: boolean
}

export type CoreCommandsDeps = {
  getSnapshot: () => RegistrySnapshot
  broker?: UiControlBroker
}

function categoryFor(id: string): CommandCategory {
  if (id.includes('.pane.') || id.includes('.surface.')) return 'pane'
  if (id.includes('.terminal')) return 'terminal'
  if (id.includes('.task') || id.includes('.agents-panel')) return 'task'
  if (id.includes('.workspace')) return 'workspace'
  if (id.includes('.editor')) return 'editor'
  if (id.includes('.settings') || id.includes('.overlay') || id.includes('.rail') || id.includes('.source')) return 'navigation'
  return 'action'
}

// The core presentation commands, generated from their input schemas (commands-and-ui.md §5, §6).
const CORE_COMMANDS: CommandContribution[] = Object.entries(CoreCommandInputs).map(([id, input]) =>
  defineCommand({ id, pluginId: 'core', title: id, description: `Core command ${id}`, category: categoryFor(id), target: 'renderer', input }),
)

function toDescriptor(c: CommandContribution): z.infer<typeof CommandDescriptorSchema> {
  let inputSchema: Record<string, unknown> = {}
  try {
    inputSchema = z.toJSONSchema(c.input, { target: 'draft-2020-12', unrepresentable: 'any', io: 'input' }) as Record<string, unknown>
  } catch {
    inputSchema = {}
  }
  return {
    id: c.id,
    pluginId: c.pluginId,
    title: c.title,
    description: c.description,
    category: c.category,
    target: c.target,
    requiredScope: 'write',
    inputSchema,
    ...(c.deprecated ? { deprecated: c.deprecated } : {}),
    availability: null, // contextual availability needs a live window/broker
  }
}

async function dispatch(deps: CoreCommandsDeps, ctx: PublicOperationContext, command: CommandContribution, body: z.infer<typeof CommandInvocationOuterSchema>) {
  const parsed = command.input.safeParse(body.input)
  if (!parsed.success) {
    throw new PublicApiError('validation_failed', `Invalid input for command ${command.id}`, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)), code: i.code, message: i.message })),
    })
  }
  const acceptedAt = Date.now()
  if (command.target === 'service' && command.run) {
    const result = await command.run(ctx, parsed.data)
    return { commandId: command.id, targetWindowId: null, acceptedAt, completedAt: Date.now(), presentationRevision: null, result }
  }
  if (!deps.broker) {
    throw new PublicApiError('ui_unavailable', 'No renderer is connected to run this presentation command')
  }
  return deps.broker.invoke({ commandId: command.id, input: parsed.data, windowId: body.target?.windowId, expectedRevision: body.expectedRevision })
}

export function buildCoreCommandsContribution(deps: CoreCommandsDeps): PluginApiContribution {
  return {
    pluginId: 'core',
    commands: CORE_COMMANDS,
    endpoints: [
      defineEndpoint({
        operationId: 'core.commands.list',
        pluginId: 'core',
        method: 'GET',
        path: '/commands',
        scope: 'read',
        risk: 'read',
        summary: 'Discover command descriptors',
        query: CommandListQuerySchema,
        response: z.strictObject({ items: z.array(CommandDescriptorSchema) }),
        handler: async (_ctx, { query }) => {
          let items = deps.getSnapshot().commands
          if (query.pluginId) items = items.filter((c) => c.pluginId === query.pluginId)
          if (query.category) items = items.filter((c) => c.category === query.category)
          if (query.target) items = items.filter((c) => c.target === query.target)
          return { items: items.map(toDescriptor) }
        },
      }),
      defineEndpoint({
        operationId: 'core.commands.get',
        pluginId: 'core',
        method: 'GET',
        path: '/commands/:commandId',
        scope: 'read',
        risk: 'read',
        summary: 'Get one command descriptor',
        params: z.strictObject({ commandId: z.string().min(3).max(200) }),
        response: CommandDescriptorSchema,
        handler: async (_ctx, { params }) => {
          const command = deps.getSnapshot().byCommandId.get(params.commandId)
          if (!command) throw new PublicApiError('command_not_found', `No command "${params.commandId}"`)
          return toDescriptor(command)
        },
      }),
      defineEndpoint({
        operationId: 'core.commands.invoke',
        pluginId: 'core',
        method: 'POST',
        path: '/commands/:commandId',
        scope: 'write',
        risk: 'write',
        summary: 'Validate, check availability, and invoke a command',
        params: z.strictObject({ commandId: z.string().min(3).max(200) }),
        body: CommandInvocationOuterSchema,
        response: CommandResultSchema,
        handler: async (ctx, { params, body }) => {
          const command = deps.getSnapshot().byCommandId.get(params.commandId)
          if (!command) throw new PublicApiError('command_not_found', `No command "${params.commandId}"`)
          return dispatch(deps, ctx, command, body)
        },
      }),
      defineEndpoint({
        operationId: 'core.ui.windows',
        pluginId: 'core',
        method: 'GET',
        path: '/ui/windows',
        scope: 'read',
        risk: 'read',
        summary: 'Connected window summaries',
        response: z.strictObject({ items: z.array(WindowSummarySchema) }),
        handler: async () => ({ items: (deps.broker?.snapshots() ?? []).map((w) => ({ windowId: w.windowId, primary: w.primary })) }),
      }),
      defineEndpoint({
        operationId: 'core.ui.primary',
        pluginId: 'core',
        method: 'GET',
        path: '/ui/primary',
        scope: 'read',
        risk: 'read',
        summary: 'Primary window presentation snapshot',
        response: WindowPresentationSchema,
        handler: async () => requireSnapshot(deps.broker?.snapshot()),
      }),
      defineEndpoint({
        operationId: 'core.ui.window',
        pluginId: 'core',
        method: 'GET',
        path: '/ui/windows/:windowId',
        scope: 'read',
        risk: 'read',
        summary: 'Presentation snapshot for a window',
        params: z.strictObject({ windowId: z.string().min(1) }),
        response: WindowPresentationSchema,
        handler: async (_ctx, { params }) => requireSnapshot(deps.broker?.snapshot(params.windowId)),
      }),
    ],
  }
}

// Presentation state is readable only while a renderer is connected (core-api.md §9).
function requireSnapshot(snapshot: unknown): z.infer<typeof WindowPresentationSchema> {
  if (snapshot == null) throw new PublicApiError('ui_unavailable', 'No renderer is connected')
  const parsed = WindowPresentationSchema.safeParse(snapshot)
  if (!parsed.success) throw new PublicApiError('ui_unavailable', 'The renderer snapshot is not available')
  return parsed.data
}
