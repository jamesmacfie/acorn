import { z } from 'zod'
import { IdSchema, UnixMillisSchema } from './primitives'

// Typed command contract (docs/public-api.md). Public commands are static,
// schema-first contributions; presentation commands run through the UI control broker (renderer).

export const CommandCategorySchema = z.enum(['navigation', 'workspace', 'task', 'pane', 'terminal', 'editor', 'action'])

export const CommandDescriptorSchema = z.strictObject({
  id: z.string().min(3).max(200),
  pluginId: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  category: CommandCategorySchema,
  target: z.enum(['renderer', 'service']),
  requiredScope: z.literal('write'),
  inputSchema: z.record(z.string(), z.unknown()), // generated JSON Schema document
  deprecated: z.strictObject({ replacement: z.string().optional(), message: z.string() }).optional(),
  availability: z
    .discriminatedUnion('available', [
      z.strictObject({ available: z.literal(true) }),
      z.strictObject({ available: z.literal(false), code: z.string(), reason: z.string() }),
    ])
    .nullable(),
})

export const CommandInvocationOuterSchema = z.strictObject({
  input: z.unknown(),
  target: z.strictObject({ windowId: z.string().min(1) }).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
})

export const CommandResultSchema = z.strictObject({
  commandId: z.string(),
  targetWindowId: z.string().nullable(),
  acceptedAt: UnixMillisSchema,
  completedAt: UnixMillisSchema,
  presentationRevision: z.number().int().nonnegative().nullable(),
  result: z.unknown(),
})

export const CommandListQuerySchema = z.strictObject({
  pluginId: z.string().max(100).optional(),
  category: CommandCategorySchema.optional(),
  target: z.enum(['renderer', 'service']).optional(),
})

// Presentation snapshot (docs/public-api.md). Reported by the renderer to the broker.
export const PaneLayoutSchema = z.strictObject({
  panes: z.array(z.string().min(1).max(200)).min(1).max(32),
  weights: z.record(z.string(), z.number().positive()).optional(),
  pinned: z.array(z.string().min(1).max(200)).max(32).optional(),
})

export const WindowPresentationSchema = z.strictObject({
  windowId: z.string().min(1),
  primary: z.boolean(),
  ready: z.boolean(),
  route: z.string(),
  activeWorkspaceId: IdSchema.nullable(),
  activeTaskId: IdSchema.nullable(),
  selectedSourceId: z.string().nullable(),
  layouts: z.record(IdSchema, PaneLayoutSchema),
  focusedPane: z.strictObject({ taskId: IdSchema, paneId: z.string() }).nullable(),
  maximized: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('none') }),
    z.strictObject({ kind: z.literal('pane'), taskId: IdSchema, paneId: z.string() }),
    z.strictObject({ kind: z.literal('terminal'), taskId: IdSchema }),
  ]),
  terminalDrawer: z.strictObject({ taskId: IdSchema, open: z.boolean() }).nullable(),
  agentsPanel: z.strictObject({ taskId: IdSchema, open: z.boolean() }).nullable(),
  overlay: z.string().nullable(),
  revision: z.number().int().nonnegative(),
})

export const WindowSummarySchema = z.strictObject({ windowId: z.string(), primary: z.boolean() })

// ---- Core presentation command input schemas (commands-and-ui.md §5) ----

const WindowTarget = z.strictObject({ windowId: z.string().min(1).optional() })
const TaskTarget = WindowTarget.extend({ taskId: IdSchema })
const PaneTarget = TaskTarget.extend({ paneId: z.string().min(1).max(200) })

export const CoreCommandInputs = {
  'core.settings.open': WindowTarget.extend({ tabId: z.string().min(1).max(200).default('workspaces') }),
  'core.settings.close': WindowTarget,
  'core.overlay.set': WindowTarget.extend({ overlayId: z.string().min(1).max(200).nullable(), query: z.string().max(4096).optional() }),
  'core.rail.collapsed.set': WindowTarget.extend({ collapsed: z.boolean() }),
  'core.workspace.activate': WindowTarget.extend({ workspaceId: IdSchema }),
  'core.source.activate': WindowTarget.extend({ sourceId: z.string().min(1).max(200), workspaceId: IdSchema.optional() }),
  'core.task.activate': TaskTarget.extend({ paneId: z.string().min(1).max(200).optional() }),
  'core.pane.show': PaneTarget.extend({ mode: z.enum(['show', 'add']).default('show') }),
  'core.pane.close': PaneTarget,
  'core.pane.pin.set': PaneTarget.extend({ pinned: z.boolean() }),
  'core.pane.move': PaneTarget.extend({ direction: z.enum(['left', 'right']) }),
  'core.agents-panel.set': TaskTarget.extend({ open: z.boolean() }),
  'core.terminal-drawer.set': TaskTarget.extend({ open: z.boolean() }),
  'core.terminal.focus': TaskTarget.extend({ sessionId: IdSchema }),
} as const
