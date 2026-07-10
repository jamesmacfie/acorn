# Protocol and strict schemas

## 1. Base URLs and discovery

```text
HTTP:      http://127.0.0.1:<apiPort>/api/v1
WebSocket: ws://127.0.0.1:<apiPort>/api/v1/ws
OpenAPI:   GET /api/v1/openapi.json
```

All three require a valid bearer token. The configurable port is described in
[core-api.md](./core-api.md). Paths are versioned; the token format version is separate.

## 2. Schema source of truth

Use Zod 4 schemas in shared/server-safe modules. Types are always inferred from the schemas, never
declared separately and asserted with `as`.

```ts
const WorkspaceSchema = z.strictObject({ /* ... */ })
type Workspace = z.infer<typeof WorkspaceSchema>
```

Every object schema uses `z.strictObject`. Never use `.passthrough()` at the public boundary.
Every union with object alternatives uses a discriminator. Strings have explicit min/max bounds;
arrays have explicit maximum lengths; integers use `.int()` and bounded ranges; ids are validated
to their actual format. Empty request bodies use `z.undefined()` rather than accepting `{}`.

The route registry records:

```ts
type PublicEndpoint<I, O> = {
  operationId: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  scope: 'read' | 'write'
  summary: string
  schemas: {
    params?: z.ZodType
    query?: z.ZodType
    headers?: z.ZodType
    body?: z.ZodType
    response: z.ZodType<O>
  }
  bodyLimitBytes?: number
  handler(ctx: PublicOperationContext, input: I): Promise<O | NoContent>
}
```

Validate success responses in development/test. In production, response validation failures are
`500 response_contract_violation` and must not leak the invalid payload.

Generate OpenAPI 3.1 from the frozen endpoint/command registries. The checked-in generated file is
optional; the runtime endpoint and a snapshot/conformance test are mandatory.

## 3. Shared primitives

```ts
import { z } from 'zod'

export const IdSchema = z.uuid()
export const UnixMillisSchema = z.number().int().nonnegative()
export const NonEmptyStringSchema = z.string().trim().min(1)
export const OwnerSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/)
export const RepoNameSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/)
export const BranchSchema = z.string().min(1).max(1024).refine((v) => !v.includes('\0'))
export const RelativePathSchema = z.string().min(1).max(4096)
  .refine((v) => !v.startsWith('/') && !v.includes('\0'))
export const PortSchema = z.number().int().min(1024).max(65535)
export const EmptySchema = z.strictObject({})

export const PageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(2048).optional(),
})

export const PageSchema = <T extends z.ZodType>(item: T) => z.strictObject({
  items: z.array(item),
  nextCursor: z.string().nullable(),
})
```

Path confinement is still enforced after schema validation using
`resolveTaskCwd`/`resolveInRoot`. A syntactically relative path is not proof that symlinks remain
inside the worktree.

## 4. JSON and HTTP conventions

- UTF-8 JSON is the default representation.
- Clients send `Content-Type: application/json` for JSON bodies.
- Unknown media types return `415 unsupported_media_type`.
- Malformed JSON returns `400 malformed_json`.
- Schema failure returns `422 validation_failed` with field issues.
- Resource creation returns `201` and a `Location` header.
- Successful deletion returns `204` with no body.
- `PATCH` is a partial update; at least one field must be present.
- `PUT` replaces the complete named sub-resource and is idempotent.
- Action-like operations that are not resources use `POST` (`/commit`, `/interrupt`, `/commands/:id`).
- Boolean query values are the exact strings `true` or `false`; do not rely on JavaScript truthiness.
- Timestamps are Unix epoch milliseconds to match Acorn's existing shared contracts and SQLite.
- Enum values and property names are lowercase camelCase unless a provider value is returned as
  opaque data.
- Responses never alternate between a domain object and `{ ok: false }`. Failures use non-2xx.
- `DELETE` request bodies are avoided; identity is expressed in the path.

## 5. Success and error envelopes

Single-resource responses are wrapped so metadata can evolve without changing the resource shape:

```ts
const DataResponseSchema = <T extends z.ZodType>(data: T) => z.strictObject({
  data,
  requestId: z.string(),
})
```

Paged responses are:

```json
{
  "data": { "items": [], "nextCursor": null },
  "requestId": "019..."
}
```

Errors always use:

```ts
const ValidationIssueSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number().int()])),
  code: z.string(),
  message: z.string(),
})

const ErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
    issues: z.array(ValidationIssueSchema).optional(),
  }),
})
```

Core status vocabulary:

| Status | Codes | Meaning |
| ---: | --- | --- |
| 400 | `malformed_json`, `bad_request` | request cannot be parsed |
| 401 | `invalid_token` | bearer absent, invalid, expired, or revoked |
| 403 | `insufficient_scope`, `forbidden_host`, `operation_forbidden` | authenticated but not authorized |
| 404 | `not_found`, `endpoint_not_found`, `command_not_found`, `plugin_not_found` | resource/contribution absent |
| 409 | `conflict`, `ui_unavailable`, `command_unavailable`, `dirty_worktree`, `port_in_use`, `config_trust_required` | state prevents operation |
| 413 | `payload_too_large` | body exceeds endpoint cap |
| 415 | `unsupported_media_type` | unsupported content type |
| 422 | `validation_failed`, `provider_validation_failed` | strict schema or semantic validation failed |
| 424 | `upstream_reauthentication_required`, `provider_unavailable` | dependency is not usable |
| 429 | `upstream_rate_limited` | upstream provider rate limit; include retry metadata |
| 500 | `internal_error`, `response_contract_violation` | unhandled/contract failure |
| 503 | `capability_unavailable`, `starting`, `shutting_down` | runtime service unavailable |
| 504 | `ui_command_timeout`, `upstream_timeout` | operation timed out |

Do not include stack traces, shell output, SQL, provider bodies, or filesystem paths in generic 500
responses. Endpoints that intentionally return command/log output declare and bound that field.

## 6. Request ids and cancellation

Accept an optional `X-Request-Id` matching `[A-Za-z0-9._:-]{1,128}`; otherwise generate one. Echo it
in `X-Request-Id` and every JSON envelope. Pass the request abort signal into services and child
process capture. Client disconnect cancels cancellable reads but does not implicitly kill a terminal
session, workflow, Git operation already handed to a child process, or upstream mutation.

## 7. Idempotency

Require `Idempotency-Key` for public operations whose retry can duplicate side effects:

- task creation;
- terminal/process creation;
- workflow start;
- PR creation, comment/review creation, and merge/auto-merge enable;
- Linear/provider comment creation;
- note/memory creation.

Schema: 1–128 printable ASCII characters excluding whitespace at either end. Store
`(tokenId, operationId, key, requestHash, responseStatus, responseBody, createdAt)` for 24 hours.

- same token + operation + key + same request returns the stored response;
- same key with different request hash returns `409 idempotency_conflict`;
- different token ids do not share keys;
- do not cache 5xx responses;
- command/presentation invocations do not use idempotency unless the command declares support.

## 8. Pagination and filtering

Use opaque base64url cursors containing a versioned stable sort tuple; sign or validate the complete
shape so callers cannot inject SQL fields. Never expose raw offsets for changing collections.
Small singleton child collections may return bounded arrays without pagination, but repos, pulls,
tasks (including archived), sessions, workflow runs, notes, memories, provider issues, and events
must have a documented bound.

Filters are explicit schema properties. Unknown query parameters fail `422`, just like unknown body
properties. A plugin cannot silently accept arbitrary provider query parameters.

## 9. Compatibility

- additive optional response fields are allowed within `v1` only when clients using strict decoders
  are expected to tolerate them; otherwise prefer a new endpoint version;
- removing/renaming fields, changing meanings, narrowing accepted inputs, or changing status codes
  requires `v2`;
- adding a new enum member is potentially breaking and must be called out in the changelog;
- plugin endpoint paths are versioned by the core API version, not by ad-hoc plugin query flags;
- endpoint and command ids are permanent once released; deprecated entries remain discoverable with
  `deprecated: true` and a replacement until the next major API version;
- the existing internal `/api/*` contract has no compatibility relationship to `/api/v1`.

