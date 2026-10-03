import { createHash, randomUUID } from 'node:crypto'
import { and, eq, isNull, or } from 'drizzle-orm'
import {
  panelPlanSchema,
  storedDashboardPanelContentSchema,
  type DashboardDraft,
  type DashboardContent,
  type PanelPlan,
  type DashboardRevision,
  type DashboardScope,
} from '@acorn/protocol/dashboards.ts'
import type { DashboardProblem } from '@acorn/dashboards-core/projection'
import { upgradePanelContent } from '@acorn/dashboards-core/plan.ts'
import { canonicalDataEncoding, parseDataValue } from '@acorn/protocol/dataValues.ts'
import type { AppDatabase } from '../db'
import { dashboardDrafts, dashboardRevisions } from './schema'

export class DashboardLibraryError extends Error {
  constructor(
    readonly code: 'not-found' | 'conflict' | 'unpublished' | 'invalid-dashboard',
    /** What publication refused, for `invalid-dashboard`. */
    readonly problems: readonly DashboardProblem[] = [],
  ) { super(code) }
}

const scopeWhere = (scope: DashboardScope) => and(
  eq(dashboardDrafts.workspaceId, scope.workspaceId),
  scope.projectId ? or(isNull(dashboardDrafts.projectId), eq(dashboardDrafts.projectId, scope.projectId)) : isNull(dashboardDrafts.projectId),
)
const readContent = (raw: string): PanelPlan => {
  const value: unknown = JSON.parse(raw)
  return value && typeof value === 'object' && 'version' in value && value.version === 2
    ? panelPlanSchema.parse(value)
    : upgradePanelContent(storedDashboardPanelContentSchema.parse(value))
}
const parseDraft = (row: typeof dashboardDrafts.$inferSelect): DashboardDraft => ({
  ...row,
  projectId: row.projectId ?? undefined,
  content: readContent(row.content),
})
const parseRevision = (row: typeof dashboardRevisions.$inferSelect): DashboardRevision => ({
  ...row,
  projectId: row.projectId ?? undefined,
  content: readContent(row.content),
})

export function dashboardStore(db: AppDatabase) {
  const store = {
    list(scope: DashboardScope): DashboardDraft[] {
      return db.select().from(dashboardDrafts).where(scopeWhere(scope)).all().map(parseDraft)
    },
    get(scope: DashboardScope, id: string): DashboardDraft {
      const row = db.select().from(dashboardDrafts).where(and(eq(dashboardDrafts.id, id), scopeWhere(scope))).get()
      if (!row) throw new DashboardLibraryError('not-found')
      return parseDraft(row)
    },
    create(scope: DashboardScope, content: DashboardContent): DashboardDraft {
      const now = Date.now()
      const id = randomUUID()
      db.insert(dashboardDrafts).values({
        ...scope, id, content: JSON.stringify(panelPlanSchema.parse('version' in content ? content : upgradePanelContent(content))),
        draftRevision: 1, createdAt: now, updatedAt: now,
      }).run()
      return store.get(scope, id)
    },
    save(scope: DashboardScope, id: string, expectedRevision: number, content: DashboardContent): DashboardDraft {
      const result = db.update(dashboardDrafts).set({
        content: JSON.stringify(panelPlanSchema.parse('version' in content ? content : upgradePanelContent(content))),
        draftRevision: expectedRevision + 1,
        updatedAt: Date.now(),
      }).where(and(eq(dashboardDrafts.id, id), scopeWhere(scope), eq(dashboardDrafts.draftRevision, expectedRevision))).run()
      if (result.changes !== 1) throw new DashboardLibraryError('conflict')
      return store.get(scope, id)
    },
    published(scope: DashboardScope, id: string, exactRevision?: number): DashboardRevision {
      const number = exactRevision ?? store.get(scope, id).publishedRevision
      if (!number) throw new DashboardLibraryError('unpublished')
      const row = db.select().from(dashboardRevisions).where(and(
        eq(dashboardRevisions.dashboardId, id), eq(dashboardRevisions.revision, number),
        eq(dashboardRevisions.workspaceId, scope.workspaceId),
        scope.projectId ? or(isNull(dashboardRevisions.projectId), eq(dashboardRevisions.projectId, scope.projectId)) : isNull(dashboardRevisions.projectId),
      )).get()
      if (!row) throw new DashboardLibraryError('not-found')
      return parseRevision(row)
    },
    publishedById(id: string): DashboardRevision {
      const draft = db.select().from(dashboardDrafts).where(eq(dashboardDrafts.id, id)).get()
      if (!draft?.publishedRevision) throw new DashboardLibraryError('unpublished')
      const row = db.select().from(dashboardRevisions).where(and(
        eq(dashboardRevisions.dashboardId, id), eq(dashboardRevisions.revision, draft.publishedRevision),
      )).get()
      if (!row) throw new DashboardLibraryError('not-found')
      return parseRevision(row)
    },
    publish(scope: DashboardScope, id: string, expectedRevision: number): DashboardRevision {
      return db.transaction(() => {
        const current = store.get(scope, id)
        if (current.draftRevision !== expectedRevision) throw new DashboardLibraryError('conflict')
        const digest = createHash('sha256').update(canonicalDataEncoding(parseDataValue(current.content))).digest('hex')
        if (current.publishedRevision) {
          const published = store.published(scope, id)
          if (published.digest === digest) return published
        }
        const next = (current.publishedRevision ?? 0) + 1
        const result = db.update(dashboardDrafts).set({
          publishedRevision: next, basePublishedRevision: next,
          draftRevision: expectedRevision + 1, updatedAt: Date.now(),
        }).where(and(eq(dashboardDrafts.id, id), scopeWhere(scope), eq(dashboardDrafts.draftRevision, expectedRevision))).run()
        if (result.changes !== 1) throw new DashboardLibraryError('conflict')
        db.insert(dashboardRevisions).values({
          dashboardId: id, revision: next, workspaceId: current.workspaceId,
          projectId: current.projectId, content: JSON.stringify(current.content), digest, createdAt: Date.now(),
        }).run()
        return store.published(scope, id, next)
      })
    },
    delete(scope: DashboardScope, id: string, expectedRevision: number): void {
      const result = db.delete(dashboardDrafts).where(and(
        eq(dashboardDrafts.id, id), scopeWhere(scope), eq(dashboardDrafts.draftRevision, expectedRevision),
      )).run()
      if (result.changes !== 1) throw new DashboardLibraryError('conflict')
    },
  }
  return store
}
