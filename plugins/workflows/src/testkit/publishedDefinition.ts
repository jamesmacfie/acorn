import { randomUUID } from 'node:crypto'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { WorkflowDef } from '../shared/workflowContracts'
import { createDef, getDef } from '../server/definitions/store'
import { publicationStore } from '../server/publication/store'
import { workflowContentFingerprint } from '../server/definitions/resolution'

/** Execution fixtures explicitly publish; production createDef creates only a draft. */
export async function createPublishedDef(db: PluginDatabase, input: { workspaceId: string; projectId?: string | null; def: WorkflowDef }) {
  const row = await createDef(db, input)
  return publishFixtureDef(db, row.id)
}

export async function publishFixtureDef(db: PluginDatabase, definitionId: string) {
  const row = (await getDef(db, definitionId))!
  const store = publicationStore(db)
  const id = randomUUID()
  const revision = (row.publishedRevision ?? 0) + 1
  const write = { kind: 'workflow' as const, id: row.id, name: row.name, draftRevision: row.revision, basePublishedRevision: row.publishedRevision ?? null, revision,
    scope: { workspaceId: row.workspaceId, projectId: row.projectId ?? undefined }, def: row.def, digest: workflowContentFingerprint(row.def) }
  store.prepare({ id, rootId: row.id, workspaceId: row.workspaceId, state: 'prepared', writes: [write], consumers: [], reused: [], landed: [], error: null, createdAt: Date.now(), updatedAt: Date.now() })
  store.write(id, write)
  store.landed(id, { kind: 'workflow', id: row.id, revision })
  store.state(id, 'complete')
  return { ...row, publishedRevision: revision, basePublishedRevision: revision }
}
