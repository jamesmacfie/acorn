import { z } from 'zod'
import type { AgentConfigOption, AgentSession } from '../contract/wire.ts'

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

export const sessionListQuerySchema = z
  .object({
    taskId: z.string().uuid().optional(),
    workspaceId: z.string().uuid().optional(),
    archived: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    attention: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    search: z.string().trim().max(500).optional(),
    cursor: z.string().max(64).optional(),
    cursorFormat: z.literal('tuple-v1').optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .transform((filter, ctx): SessionListFilter => {
    if (filter.cursor === undefined) return filter
    try {
      const parsed = sessionCursor(filter.cursor, filter.cursorFormat)
      return { ...filter, cursor: typeof parsed === 'number' ? parsed : filter.cursor }
    } catch {
      ctx.addIssue({ code: 'custom', path: ['cursor'], message: 'Invalid session cursor.' })
      return z.NEVER
    }
  })

// A session list draws each row's title, state, time, and chosen model. What only an open session reads
// stays out of it: the slash commands and skills the provider advertised, the standing context, and
// every config option value but the chosen one. Those run to tens of kilobytes a session, so a full
// page of whole rows is megabytes.
const DETAIL_CONFIG_KEYS = ['commands', 'skills', 'standingContext', 'standingContextTold'] as const

const configOptionsOf = (config: AgentSession['config']): AgentConfigOption[] | undefined =>
  Array.isArray(config.configOptions) ? (config.configOptions as AgentConfigOption[]) : undefined

export function sessionListRow(session: AgentSession): AgentSession {
  const config = { ...session.config }
  for (const key of DETAIL_CONFIG_KEYS) delete config[key]
  const options = configOptionsOf(config)
  if (options)
    config.configOptions = options.map((option) => ({
      ...option,
      values: option.values.filter((value) => value.value === option.currentValue),
    }))
  return { ...session, config, listRow: true }
}

/** A list row with the detail a full row of the same session already brought. The list row's chosen
 *  values win, since it can be the newer of the two. */
export function withSessionDetail(row: AgentSession, full: AgentSession): AgentSession {
  const { listRow: _listRow, ...session } = row
  const config = { ...row.config }
  for (const key of DETAIL_CONFIG_KEYS) if (key in full.config) config[key] = full.config[key]
  const fullOptions = configOptionsOf(full.config)
  if (fullOptions) {
    const chosen = new Map(configOptionsOf(row.config)?.map((option) => [option.id, option.currentValue]))
    config.configOptions = fullOptions.map((option) =>
      chosen.has(option.id) ? { ...option, currentValue: chosen.get(option.id) ?? null } : option,
    )
  }
  return { ...session, config }
}
