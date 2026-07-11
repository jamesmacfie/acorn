import { z } from 'zod'

// Shared strict primitives for the public /api/v1 surface (docs/next/api/protocol.md §3). Every
// public object schema is a z.strictObject; strings/arrays/ints carry explicit bounds. Types are
// always inferred from the schema, never declared separately.

export const IdSchema = z.uuid()
export const UnixMillisSchema = z.number().int().nonnegative()
export const NonEmptyStringSchema = z.string().trim().min(1)
export const OwnerSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/)
export const RepoNameSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/)
export const BranchSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((v) => !v.includes('\0'), 'branch must not contain NUL')
export const RelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => !v.startsWith('/') && !v.includes('\0'), 'path must be relative and NUL-free')
export const PortSchema = z.number().int().min(1024).max(65535)
export const EmptySchema = z.strictObject({})

// A token is either read-only or read+write. write is never issued without read; a bare ['write'],
// duplicates, or a different order are invalid (docs/next/api/authentication.md §2).
export const ApiScopeSchema = z.enum(['read', 'write'])
export const ApiScopesSchema = z.union([
  z.tuple([z.literal('read')]),
  z.tuple([z.literal('read'), z.literal('write')]),
])
export type ApiScope = z.infer<typeof ApiScopeSchema>
export type ApiScopes = z.infer<typeof ApiScopesSchema>

export const PageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(2048).optional(),
})

export const PageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.strictObject({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  })

// X-Request-Id grammar (docs/next/api/protocol.md §6).
export const RequestIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)

// Idempotency-Key grammar (docs/next/api/protocol.md §7): 1–128 printable ASCII, no surrounding
// whitespace.
export const IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+(?: *[\x21-\x7e]+)*$/, 'must be 1-128 printable ASCII characters')
