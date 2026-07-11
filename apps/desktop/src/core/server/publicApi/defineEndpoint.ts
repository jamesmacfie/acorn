import type { z } from 'zod'
import type { ApiScope, ApiScopes } from '../../shared/publicApi/primitives'
import type { ApiTokenPrincipal } from './tokenService'

// Schema-first endpoint/command/event contracts for the public API (docs/next/api/plugin-api.md §2,
// protocol.md §2). Handlers are thin: they validate nothing themselves and call an application
// service. Types are inferred from the Zod schemas, never declared and asserted.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type EndpointRisk = 'read' | 'write' | 'execute'
export type SuccessStatus = 200 | 201 | 202 | 204
export type IdempotencyMode = 'required' | 'optional' | 'forbidden'

// A handler may return a real payload or NO_CONTENT (→ 204). Kept a symbol so `undefined` payloads
// are distinguishable from "no content".
export const NO_CONTENT = Symbol('no-content')
export type NoContent = typeof NO_CONTENT

// The authenticated caller behind a public request. Only 'api-token' reaches public handlers, but
// the shared shape carries the other kinds so services can be reused by internal callers.
export type OperationActor = {
  principalId: string
  principalKind: 'browser' | 'internal' | 'api-token' | 'system'
  tokenId?: string
  scopes?: ApiScopes
}

// Minimal event publisher; fleshed out by the event bus (Phase 7). Present here so endpoint
// handlers can emit domain events after a commit without importing the bus.
export interface EventPublisher {
  publish(event: {
    channel: string
    data: unknown
    resource?: { type: string; id: string }
    // Filter hints for WS subscriptions (events.md §4).
    taskId?: string
    workspaceId?: string
  }): void
}

export type PublicOperationContext = {
  actor: OperationActor
  // The fully resolved bearer principal (token metadata + linked GitHub identity). Endpoints that
  // report on the caller (e.g. GET /principal) or resolve upstream credentials read this; services
  // take the narrower `actor` for provenance.
  principal: ApiTokenPrincipal
  signal: AbortSignal
  requestId: string
  publish: EventPublisher
  // Present only when the request carried an Idempotency-Key; services that declare
  // idempotency read it, but replay is handled by middleware, not the handler.
  idempotencyKey?: string
}

type InferOr<T extends z.ZodTypeAny | undefined, Fallback> = T extends z.ZodTypeAny
  ? z.infer<T>
  : Fallback

export type EndpointInput<
  P extends z.ZodTypeAny | undefined,
  Q extends z.ZodTypeAny | undefined,
  H extends z.ZodTypeAny | undefined,
  B extends z.ZodTypeAny | undefined,
> = {
  params: InferOr<P, undefined>
  query: InferOr<Q, undefined>
  headers: InferOr<H, undefined>
  body: InferOr<B, undefined>
}

export type EndpointDef<
  P extends z.ZodTypeAny | undefined = undefined,
  Q extends z.ZodTypeAny | undefined = undefined,
  H extends z.ZodTypeAny | undefined = undefined,
  B extends z.ZodTypeAny | undefined = undefined,
  R extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  operationId: string
  pluginId: string // 'core' for core endpoints
  method: HttpMethod
  // Path relative to /api/v1. Plugin endpoints are always under /plugins/<pluginId>. Params use the
  // Hono `:name` form; the OpenAPI generator rewrites them to `{name}`.
  path: string
  scope: ApiScope
  risk: EndpointRisk
  summary: string
  description?: string
  params?: P
  query?: Q
  headers?: H
  body?: B
  response: R
  status?: SuccessStatus
  idempotency?: IdempotencyMode
  bodyLimitBytes?: number
  deprecated?: { replacement?: string; message: string }
  handler: (ctx: PublicOperationContext, input: EndpointInput<P, Q, H, B>) => Promise<z.infer<R> | NoContent>
}

// Type-erased endpoint stored in the registry. The generic identity is preserved by defineEndpoint
// at the call site; the registry validates + dispatches against the erased shape.
export type AnyEndpoint = EndpointDef<
  z.ZodTypeAny | undefined,
  z.ZodTypeAny | undefined,
  z.ZodTypeAny | undefined,
  z.ZodTypeAny | undefined,
  z.ZodTypeAny
>

export function defineEndpoint<
  P extends z.ZodTypeAny | undefined = undefined,
  Q extends z.ZodTypeAny | undefined = undefined,
  H extends z.ZodTypeAny | undefined = undefined,
  B extends z.ZodTypeAny | undefined = undefined,
  R extends z.ZodTypeAny = z.ZodTypeAny,
>(def: EndpointDef<P, Q, H, B, R>): AnyEndpoint {
  return def as unknown as AnyEndpoint
}

// ---- Events (docs/next/api/events.md §5) ----

export type EventContribution = {
  pluginId: string
  channel: string // `${plugin}.${noun}` — dot-namespaced
  description: string
  schema: z.ZodTypeAny
  scope: 'read'
}

export function defineEvent(def: EventContribution): EventContribution {
  return def
}

// ---- A plugin's public contribution bundle (endpoints + events + commands) ----

export type CommandCategory = 'navigation' | 'workspace' | 'task' | 'pane' | 'terminal' | 'editor' | 'action'

// A typed command contribution (docs/next/api/commands-and-ui.md §2). Presentation commands are
// 'renderer'-target and run through the UI control broker; 'service'-target commands run inline.
export type CommandContribution = {
  id: string
  pluginId: string
  title: string
  description: string
  category: CommandCategory
  target: 'renderer' | 'service'
  input: z.ZodTypeAny
  deprecated?: { replacement?: string; message: string }
  // Present for 'service'-target commands; 'renderer' commands dispatch through the broker.
  run?: (ctx: PublicOperationContext, input: unknown) => Promise<unknown>
}

export function defineCommand(command: CommandContribution): CommandContribution {
  return command
}

export type PluginApiContribution = {
  pluginId: string
  endpoints?: readonly AnyEndpoint[]
  events?: readonly EventContribution[]
  commands?: readonly CommandContribution[]
}
