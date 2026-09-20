import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { workflowFileDrafts, workflowFileOperations } from '../node/schema'
import type { WorkflowDef } from '../shared/workflowContracts'
import type { WorkflowFileDraft, WorkflowFileOperation, WorkflowFileRequest, WorkflowFileResult, WorkflowFileTarget } from '../shared/workflowFileAuthoring'
import { mergeWorkflow } from '../shared/workflowMerge'
import { parseWorkflowToml } from './workflowFiles'
import { prepareWorkflowExport, type WorkflowExportDeps } from './workflowExport'
import { fileHash, readWorkflowFile, writeWorkflowFile, type WorkflowFileRoot } from './workflowFileWrites'
import { validateWorkflow } from './workflowValidation'
import { writeWorkflowToml } from './workflowToml'
import { reviewFileDependencies } from './workflowFileReview'

type FileScope = WorkflowFileRoot & { workspaceId: string }
type Deps = WorkflowExportDeps & {
  scope(projectId: string, source: 'repo' | 'user'): Promise<FileScope>
  afterWrite?(path: string): void
}
const draftKey = (target: WorkflowFileTarget) => JSON.stringify([target.projectId, target.source, target.path])

function definition(text: string, target: WorkflowFileTarget): WorkflowDef {
  const errors: { source: string; message: string }[] = []
  const parsed = parseWorkflowToml(text, target.path, target.source, errors)
  if (!parsed || errors.length) throw new Error(`Open ${target.path} in a text editor: ${errors.map(error => error.message).join('; ')}`)
  if (parsed.steps.some(step => step.workflowRef)) throw new Error(`Open ${target.path} in a text editor to replace static workflow composition before visual editing`)
  const { id: _id, source: _source, ...def } = parsed
  return JSON.parse(JSON.stringify(def)) as WorkflowDef
}

export function workflowFileAuthoring(db: PluginDatabase, deps: Deps) {
  const operation = (id: string): WorkflowFileOperation => {
    const row = db.select().from(workflowFileOperations).where(eq(workflowFileOperations.id, id)).get()
    if (!row) throw new Error('File publication not found')
    return JSON.parse(row.contentJson)
  }
  const persist = (value: WorkflowFileOperation) => db.insert(workflowFileOperations).values({ id: value.id, projectId: value.projectId, contentJson: JSON.stringify(value) })
    .onConflictDoUpdate({ target: workflowFileOperations.id, set: { contentJson: JSON.stringify(value) } }).run()
  const all = (): WorkflowFileOperation[] => db.select().from(workflowFileOperations).all().map(row => JSON.parse(row.contentJson))
  const list = (projectId: string): WorkflowFileOperation[] => db.select().from(workflowFileOperations).where(eq(workflowFileOperations.projectId, projectId)).all().map(row => JSON.parse(row.contentJson))
  const draft = (target: WorkflowFileTarget): WorkflowFileDraft | undefined => {
    const row = db.select().from(workflowFileDrafts).where(eq(workflowFileDrafts.id, draftKey(target))).get()
    return row ? { ...JSON.parse(row.contentJson), revision: row.revision } : undefined
  }
  const save = (value: WorkflowFileDraft, expected: number) => {
    const changed = db.update(workflowFileDrafts).set({ revision: expected + 1, contentJson: JSON.stringify({ ...value, revision: expected + 1 }) })
      .where(and(eq(workflowFileDrafts.id, value.id), eq(workflowFileDrafts.revision, expected))).returning().all()
    if (changed.length !== 1) throw new Error('File draft changed on another device. Reload to review its changes.')
    return { ...value, revision: expected + 1 }
  }
  const prepare = (value: WorkflowFileOperation) => {
    db.transaction(() => {
      const candidates = value.source === 'user' ? all() : list(value.projectId)
      for (const pending of candidates) if (pending.state !== 'complete' && pending.source === value.source && pending.writes.some(write => value.writes.some(next => next.path === write.path))) throw new Error(`Resume file publication ${pending.id} before publishing these files`)
      persist(value)
    })
    return value
  }

  return async (request: WorkflowFileRequest): Promise<WorkflowFileResult> => {
    if (request.action === 'discard') {
      const value = operation(request.id)
      const scope = await deps.scope(value.projectId, value.source)
      if (value.writes.some(write => write.landed || (value.state !== 'prepared' && readWorkflowFile(scope, write.path) === write.text))) throw new Error('This operation has written files. Resume it instead.')
      db.delete(workflowFileOperations).where(eq(workflowFileOperations.id, value.id)).run()
      return {}
    }
    if (request.action === 'list') {
      await deps.scope(request.projectId, 'repo')
      return { operations: list(request.projectId) }
    }
    if (request.action === 'publish') {
      const addressed = operation(request.id)
      const scope = await deps.scope(addressed.projectId, addressed.source)
      const current = operation(request.id)
      if (current.root !== scope.root) throw new Error('Project location changed after review. Restore its location before resuming.')
      if (current.state === 'complete') return { operation: current }
      try {
        for (const reused of current.reused) {
          const text = readWorkflowFile(scope, reused.path)
          if (text === null || fileHash(text) !== reused.hash) throw new Error(`Repository dependency changed: ${reused.path}`)
        }
        const resuming = current.state !== 'prepared'
        current.state = 'publishing'
        persist(current)
        for (const write of current.writes) {
          const text = readWorkflowFile(scope, write.path)
          if (write.landed || (resuming && text !== null && fileHash(text) === fileHash(write.text))) {
            if (text === null || fileHash(text) !== fileHash(write.text)) throw new Error(`Published file changed: ${write.path}`)
          } else {
            writeWorkflowFile(scope, write)
            deps.afterWrite?.(write.path)
          }
          write.landed = true
          persist(current)
        }
        current.state = 'complete'
        delete current.error
        db.transaction(() => {
          persist(current)
          if (current.draftId) {
            const row = db.select().from(workflowFileDrafts).where(eq(workflowFileDrafts.id, current.draftId)).get()
            if (row) {
              const value = JSON.parse(row.contentJson) as WorkflowFileDraft
              const text = current.writes[0]!.text
              // A save during publication keeps its local changes and advances only its file base.
              save({ ...value, baseText: text, baseHash: fileHash(text) }, row.revision)
            }
          }
        })
      } catch (error) {
        current.state = 'needs-reconciliation'
        current.error = error instanceof Error ? error.message : 'File publication failed'
        persist(current)
      }
      return { operation: current }
    }
    if (request.action === 'export') {
      const scope = await deps.scope(request.projectId, 'repo')
      const plan = await prepareWorkflowExport(db, request.id, { workspaceId: scope.workspaceId, projectId: request.projectId, repoDir: scope.root, userDir: null }, scope, deps)
      return { operation: prepare({ ...plan, root: scope.root, id: randomUUID(), rootId: request.id, projectId: request.projectId, source: 'repo', state: 'prepared' }) }
    }
    const { target } = request
    const scope = await deps.scope(target.projectId, target.source)
    const text = readWorkflowFile(scope, target.path)
    let value = draft(target)
    if (request.action === 'open') {
      if (value) return { draft: value }
      if (text === null) throw new Error(`Workflow file was deleted: ${target.path}`)
      value = { ...target, id: draftKey(target), revision: 1, baseText: text, baseHash: fileHash(text), def: definition(text, target) }
      db.insert(workflowFileDrafts).values({ id: value.id, revision: 1, contentJson: JSON.stringify(value) }).onConflictDoNothing().run()
      return { draft: draft(target)! }
    }
    if (!value || value.revision !== request.revision) throw new Error('File draft changed on another device. Reload to review its changes.')
    if (request.action === 'save') return { draft: save({ ...value, def: request.def }, request.revision) }
    if (text === null) throw new Error(`Workflow file was deleted outside Acorn: ${target.path}. Restore it before publishing.`)
    if (fileHash(text) !== value.baseHash) {
      if (Object.keys(request.choices ?? {}).length && request.externalHash !== fileHash(text)) throw new Error('File changed again during conflict review. Reload the review before choosing.')
      const merged = mergeWorkflow(definition(value.baseText, target), value.def, definition(text, target), request.choices)
      if (merged.conflicts.length) return { draft: value, conflicts: merged.conflicts, externalHash: fileHash(text) }
      value = save({ ...value, def: merged.value, baseText: text, baseHash: fileHash(text) }, value.revision)
    }
    const problems = validateWorkflow(value.def, deps.catalog)
    if (problems.length) throw new Error(problems.join('; '))
    const repo = target.source === 'repo' ? scope : await deps.scope(target.projectId, 'repo')
    const user = target.source === 'user' ? scope : await deps.scope(target.projectId, 'user')
    const reused = await reviewFileDependencies(db, value.def, target, { workspaceId: scope.workspaceId, projectId: target.projectId, repoDir: repo.root, userDir: user.root }, scope, deps.catalog)
    if (draft(target)?.revision !== value.revision) throw new Error('File draft changed during review. Review it again before publishing.')
    return { draft: value, operation: prepare({ id: randomUUID(), root: scope.root, projectId: target.projectId, source: target.source, rootPath: target.path,
      draftId: value.id, draftRevision: value.revision, state: 'prepared', writes: [{ path: target.path, expectedHash: value.baseHash, text: writeWorkflowToml(value.def), landed: false }], reused, setup: [] }) }
  }
}
