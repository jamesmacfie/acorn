import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { WorkflowFileWrite } from '../shared/workflowFileAuthoring'

export type WorkflowFileRoot = { root: string; resolveInRoot(root: string, path: string): string | null }
export const fileHash = (text: string): string => createHash('sha256').update(text).digest('hex')

export function confinedWorkflowFile(scope: WorkflowFileRoot, path: string): string {
  if (!/^\.acorn\/workflows\/[A-Za-z0-9][A-Za-z0-9_-]*\.toml$/.test(path)) throw new Error('Choose a workflow file inside .acorn/workflows')
  const absolute = scope.resolveInRoot(scope.root, path)
  if (!absolute) throw new Error('Workflow file is outside the allowed root')
  return absolute
}

export function readWorkflowFile(scope: WorkflowFileRoot, path: string): string | null {
  const absolute = confinedWorkflowFile(scope, path)
  try {
    if (!lstatSync(absolute).isFile()) throw new Error('Workflow path must be a regular file')
    return readFileSync(absolute, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function removeFailedWrite(path: string, cause: unknown): never {
  try {
    unlinkSync(path)
  } catch (cleanupError) {
    if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new AggregateError([cause, cleanupError], 'Workflow publication failed and its temporary file could not be removed')
    }
  }
  throw cause
}

/** Recheck immediately before rename. External editors do not share Acorn's journal or locks. */
export function writeWorkflowFile(scope: WorkflowFileRoot, write: WorkflowFileWrite): void {
  const check = () => {
    const current = readWorkflowFile(scope, write.path)
    if ((current === null ? null : fileHash(current)) !== write.expectedHash) throw new Error(`File changed outside Acorn: ${write.path}`)
  }
  check()
  const absolute = confinedWorkflowFile(scope, write.path)
  mkdirSync(dirname(absolute), { recursive: true })
  const tempPath = `${write.path}.${randomUUID()}.tmp`
  const temp = scope.resolveInRoot(scope.root, tempPath)
  if (!temp) throw new Error('Temporary file is outside the allowed root')
  try {
    writeFileSync(temp, write.text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    check()
    if (confinedWorkflowFile(scope, write.path) !== absolute || scope.resolveInRoot(scope.root, tempPath) !== temp) throw new Error('Workflow path changed during publication')
    renameSync(temp, absolute)
  } catch (error) {
    removeFailedWrite(temp, error)
  }
}
