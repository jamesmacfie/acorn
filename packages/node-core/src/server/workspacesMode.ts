import { and, eq, sql } from 'drizzle-orm'
import { WORKSPACES_PREF_KEY, workspacesMode, type WorkspacesMode } from '@acorn/protocol/workspacesMode.ts'
import type { AppDatabase } from './db'
import { schema } from './db'

type ModeDatabase = Pick<AppDatabase, 'select' | 'insert'>

export const WORKSPACES_OFF_MESSAGE = 'Projects are separate on this Node. Add a project instead.'

export function projectCount(db: ModeDatabase): number {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(schema.projects)
    .get()!.count
}

export function storedWorkspacesMode(db: ModeDatabase, ownerId: string): string | null {
  return (
    db
      .select({ value: schema.prefs.value })
      .from(schema.prefs)
      .where(and(eq(schema.prefs.userId, ownerId), eq(schema.prefs.key, WORKSPACES_PREF_KEY)))
      .get()?.value ?? null
  )
}

export function nodeWorkspacesMode(db: ModeDatabase, ownerId: string): WorkspacesMode {
  return workspacesMode(storedWorkspacesMode(db, ownerId), projectCount(db))
}

export function settleWorkspacesMode(db: ModeDatabase, ownerId: string): WorkspacesMode {
  const stored = storedWorkspacesMode(db, ownerId)
  const mode = workspacesMode(stored, projectCount(db))
  if (stored === null) db.insert(schema.prefs).values({ userId: ownerId, key: WORKSPACES_PREF_KEY, value: mode }).run()
  return mode
}
