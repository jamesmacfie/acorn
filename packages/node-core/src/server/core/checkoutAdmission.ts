import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { TaskService } from './tasks'
import type { ProjectService } from './projectRefs'
import type { CoreGitService } from './index'
import type { AppDatabase } from '../db'
import { isTaskArchiving } from '../worktrees/archiveGate'
import { BridgeError } from '../bridge'

export type CheckoutActivity = { taskId: string; description: string }
export type CheckoutActivityReader = (taskIds: readonly string[]) => Promise<CheckoutActivity[]>
const byDatabase = new WeakMap<AppDatabase, CheckoutAdmission>()
export const registerCheckoutAdmission = (db: AppDatabase, admission: CheckoutAdmission) => { byDatabase.set(db, admission) }
export const checkoutAdmissionFor = (db: AppDatabase): CheckoutAdmission | undefined => byDatabase.get(db)
export const admitCheckout = <T>(db: AppDatabase, taskId: string, action: () => Promise<T>): Promise<T> => {
  const admission = byDatabase.get(db)
  if (!admission) throw new BridgeError(503, 'checkout_admission_unavailable', 'Checkout admission is unavailable.')
  return admission.admitWork(taskId, action)
}

/** Serializes Acorn's admission decisions for one canonical checkout. Owner state stays with its owner. */
export function createCheckoutAdmission(
  tasks: TaskService,
  projects: ProjectService,
  git?: CoreGitService,
  // Archived tasks can still have unsettled owner work during cancellation or teardown.
  candidates: TaskService['active'] = tasks.active,
) {
  const readers = new Map<string, CheckoutActivityReader>()
  const tails = new Map<string, Promise<void>>()
  const canonical = async (path: string) => realpath(path).catch(() => resolve(path))
  const identity = async (taskId: string) => {
    const task = await tasks.load(taskId)
    if (!task) throw new BridgeError(404, 'task_missing', 'Task not found on this Node.')
    const project = await projects.byId(task.projectId)
    if (!project?.path) throw new BridgeError(409, 'checkout_unmapped', 'Task checkout is not mapped on this Node.')
    // An unmaterialized branch is conservatively associated with its project checkout.
    return canonical(task.worktreePath ?? project.path)
  }
  const lockKey = async (taskId: string) => {
    const task = await tasks.load(taskId)
    if (!task) return `task:${taskId}`
    const project = await projects.byId(task.projectId)
    const mappedPath = project?.path ?? task.worktreePath
    if (!mappedPath) return `task:${taskId}`
    if (git) {
      try {
        const common = await git.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: mappedPath, maxOutputBytes: 8192 })
        if (common.code === 0) return canonical(common.stdout.trim())
      } catch { /* A missing project checkout still uses its mapped path as the admission key. */ }
    }
    return canonical(mappedPath)
  }
  const withKey = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const before = tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const settled = new Promise<void>((resolve) => { release = resolve })
    const tail = before.then(() => settled)
    tails.set(key, tail)
    await before
    try { return await operation() }
    finally {
      release()
      if (tails.get(key) === tail) tails.delete(key)
    }
  }
  const owners = async (key: string) => {
    const active = await candidates()
    const matches: string[] = []
    for (const task of active) {
      const project = await projects.byId(task.projectId)
      const path = task.worktreePath ?? project?.path
      if (path && await canonical(path) === key) matches.push(task.id)
    }
    return matches
  }
  const activityOn = async (checkoutKey: string) => {
    if (!['turns', 'runs', 'setup'].every((owner) => readers.has(owner))) {
      throw new BridgeError(503, 'checkout_activity_unavailable', 'Checkout activity is unavailable. Reconnect the work owners before writing.')
    }
    const taskIds = await owners(checkoutKey)
    const activity = await Promise.all(['turns', 'runs', 'setup'].map((owner) => readers.get(owner)!(taskIds)))
      .then((rows) => rows.flat(), () => { throw new BridgeError(503, 'checkout_activity_unavailable', 'Cannot verify owner activity for this checkout.') })
    return { taskIds, activity }
  }
  return {
    registerOwner(owner: string, reader: CheckoutActivityReader) {
      if (readers.has(owner)) throw new Error(`${owner} checkout activity is already registered.`)
      readers.set(owner, reader)
      return () => { if (readers.get(owner) === reader) readers.delete(owner) }
    },
    async admitWork<T>(taskId: string, action: () => Promise<T>): Promise<T> {
      const key = await lockKey(taskId)
      return withKey(key, async () => {
        if (await lockKey(taskId) !== key) throw new BridgeError(409, 'checkout_moved', 'Task checkout moved during admission. Retry from its current location.')
        return action()
      })
    },
    /** Activity on the task's checkout, for display before a write. Only `write` decides admission. */
    async activity(taskId: string): Promise<CheckoutActivity[]> {
      return (await activityOn(await identity(taskId))).activity
    },
    async write<T>(taskId: string, action: (checkout: string) => Promise<T>): Promise<T> {
      const checkoutKey = await identity(taskId)
      const repositoryKey = await lockKey(taskId)
      return withKey(repositoryKey, async () => {
        if (await lockKey(taskId) !== repositoryKey || await identity(taskId) !== checkoutKey) {
          throw new BridgeError(409, 'checkout_moved', 'Target checkout or repository moved. Refresh and try again.')
        }
        const { taskIds, activity } = await activityOn(checkoutKey)
        if (!taskIds.includes(taskId) || !(await tasks.active()).some((task) => task.id === taskId)) {
          throw new BridgeError(409, 'task_inactive', 'Target task is no longer active.')
        }
        if (taskIds.some(isTaskArchiving)) throw new BridgeError(409, 'task_archiving', 'Task archive is in progress for this checkout.')
        if (activity.length) throw new BridgeError(409, 'checkout_busy', `Checkout is busy: ${activity.map((item) => `${item.taskId} ${item.description}`).join(', ')}.`)
        const task = await tasks.load(taskId)
        if (!task) throw new BridgeError(409, 'task_inactive', 'Target task is no longer active.')
        const checkout = await identity(taskId)
        if (checkout !== checkoutKey) throw new BridgeError(409, 'checkout_moved', 'Target checkout moved. Refresh and try again.')
        return action(checkout)
      })
    },
  }
}

export type CheckoutAdmission = ReturnType<typeof createCheckoutAdmission>
