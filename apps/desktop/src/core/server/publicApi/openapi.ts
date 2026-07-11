import { z } from 'zod'
import { ErrorResponseSchema } from '../../shared/publicApi/errors'
import type { AnyEndpoint } from './defineEndpoint'
import type { RegistrySnapshot } from './registry'

// Generate an OpenAPI 3.1 document from the frozen registry (docs/public-api.md). A thin
// generator over Zod 4's native z.toJSONSchema keeps the registry — not an OpenAPI-specific Hono
// class — the product abstraction (implementation-plan.md Phase 0 §5).

type JsonSchema = Record<string, unknown>

function toJson(schema: z.ZodTypeAny): JsonSchema {
  try {
    // draft-2020-12 is what OpenAPI 3.1 embeds; `any` keeps unrepresentable nodes from throwing.
    return z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any', io: 'input' }) as JsonSchema
  } catch {
    return {}
  }
}

function shapeOf(schema: z.ZodTypeAny | undefined): Record<string, z.ZodTypeAny> | null {
  const shape = (schema as unknown as { shape?: Record<string, z.ZodTypeAny> } | undefined)?.shape
  return shape ?? null
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const t = (schema as unknown as { _zod?: { def?: { type?: string } } })._zod?.def?.type
  return t === 'optional' || t === 'default'
}

// Hono `:param` → OpenAPI `{param}`.
function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

function parameters(endpoint: AnyEndpoint): JsonSchema[] {
  const out: JsonSchema[] = []
  const params = shapeOf(endpoint.params)
  if (params) {
    for (const [name, schema] of Object.entries(params)) {
      out.push({ name, in: 'path', required: true, schema: toJson(schema) })
    }
  }
  const query = shapeOf(endpoint.query)
  if (query) {
    for (const [name, schema] of Object.entries(query)) {
      out.push({ name, in: 'query', required: !isOptional(schema), schema: toJson(schema) })
    }
  }
  return out
}

function successResponse(endpoint: AnyEndpoint): JsonSchema {
  const status = endpoint.status ?? 200
  if (status === 204) return { 204: { description: 'No content' } }
  return {
    [String(status)]: {
      description: 'Success',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['data', 'requestId'],
            properties: { data: toJson(endpoint.response), requestId: { type: 'string' } },
            additionalProperties: false,
          },
        },
      },
    },
  }
}

const ERROR_REF = { $ref: '#/components/schemas/ErrorResponse' }

export function generateOpenApi(snapshot: RegistrySnapshot, version = '1.0.0'): JsonSchema {
  const paths: Record<string, JsonSchema> = {}
  for (const endpoint of snapshot.endpoints) {
    const fullPath = endpoint.pluginId === 'core' ? endpoint.path : `/plugins/${endpoint.pluginId}${endpoint.path}`
    const p = openApiPath(`/api/v1${fullPath}`)
    const item = (paths[p] ??= {})
    const operation: JsonSchema = {
      operationId: endpoint.operationId,
      summary: endpoint.summary,
      ...(endpoint.description ? { description: endpoint.description } : {}),
      tags: [endpoint.pluginId],
      parameters: parameters(endpoint),
      security: [{ bearerAuth: [] }],
      responses: {
        ...successResponse(endpoint),
        '401': { description: 'invalid_token', content: { 'application/json': { schema: ERROR_REF } } },
        '403': { description: 'insufficient_scope / forbidden_host', content: { 'application/json': { schema: ERROR_REF } } },
        '422': { description: 'validation_failed', content: { 'application/json': { schema: ERROR_REF } } },
        '500': { description: 'internal_error', content: { 'application/json': { schema: ERROR_REF } } },
      },
      'x-acorn-scope': endpoint.scope,
      'x-acorn-risk': endpoint.risk,
      ...(endpoint.idempotency ? { 'x-acorn-idempotency': endpoint.idempotency } : {}),
      ...(endpoint.deprecated ? { deprecated: true } : {}),
    }
    if (endpoint.body) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: toJson(endpoint.body) } },
      }
    }
    item[endpoint.method.toLowerCase()] = operation
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Acorn Automation API', version, 'x-api-version': 'v1' },
    servers: [{ url: '/', description: 'Loopback automation listener' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'acorn_v1_<id>_<secret>' },
      },
      schemas: {
        ErrorResponse: toJson(ErrorResponseSchema),
      },
    },
    security: [{ bearerAuth: [] }],
    // Event channel schemas are discovery metadata (events.md §5); surfaced as an extension.
    'x-acorn-events': snapshot.events.map((e) => ({
      channel: e.channel,
      pluginId: e.pluginId,
      description: e.description,
      schema: toJson(e.schema),
    })),
  }
}
