import { z } from 'zod'

export type SessionListFilter = {
  taskId?: string
  workspaceId?: string
  archived?: boolean
  attention?: boolean
  search?: string
  cursor?: number | string
  cursorFormat?: 'tuple-v1'
  limit?: number
}

export type SessionCursor = number | { updatedAt: number; id: string }

export function sessionCursor(cursor: number | string, format?: 'tuple-v1'): SessionCursor {
  if (typeof cursor === 'number' || /^\d{1,16}$/.test(cursor)) {
    const timestamp = Number(cursor)
    if (Number.isSafeInteger(timestamp) && timestamp > 0) return timestamp
  } else if (format === 'tuple-v1' && cursor.length <= 64) {
    const match = /^v1:(\d{1,16}):([0-9a-f-]{36})$/.exec(cursor)
    if (match && z.string().uuid().safeParse(match[2]).success) {
      const updatedAt = Number(match[1])
      if (Number.isSafeInteger(updatedAt) && updatedAt > 0) return { updatedAt, id: match[2]! }
    }
  }
  throw new Error('Invalid session cursor.')
}

export const sessionListQuerySchema = z.object({
  taskId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  archived: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  attention: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  search: z.string().trim().max(500).optional(),
  cursor: z.string().max(64).optional(),
  cursorFormat: z.literal('tuple-v1').optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).transform((filter, ctx): SessionListFilter => {
  if (filter.cursor === undefined) return filter
  try {
    const parsed = sessionCursor(filter.cursor, filter.cursorFormat)
    return { ...filter, cursor: typeof parsed === 'number' ? parsed : filter.cursor }
  } catch {
    ctx.addIssue({ code: 'custom', path: ['cursor'], message: 'Invalid session cursor.' })
    return z.NEVER
  }
})
