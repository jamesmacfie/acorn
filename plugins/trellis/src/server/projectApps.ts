import type { PublishMode } from '../shared/api'
import { AppConflict, type AppMeta, type AppStore } from './store'

// Project apps and drafts (docs/agent-built-apps/project-apps.md § Publishing). The first publish
// copies a task app's head into a new app the project owns, and the task app becomes its draft, so the
// agent keeps editing the app it already knows. Publishing the draft again moves the project app's
// head, unless the head moved since the draft started.

export type ProjectAppDeps = { store: AppStore; changed(meta: AppMeta): void }

/** A draft's project app, while it's still in the project and not deleted. */
async function liveTarget(store: AppStore, draft: AppMeta, projectId: string): Promise<AppMeta | null> {
  const target = draft.draftOf ? await store.meta(draft.draftOf.appId) : null
  return target && !target.deletedAt && target.projectId === projectId ? target : null
}

/** Whether a task app has a head its project app doesn't have yet. */
export const unpublished = (meta: AppMeta) => meta.head > 0 && meta.head !== meta.draftOf?.head

/** Publishes a task app's head to its task's project. Answers the project app and its new revision,
 *  `conflict` when the project app moved since the draft started and `mode` is `safe`, or null when
 *  there's no shown task app. */
export async function publishToProject(
  { store, changed }: ProjectAppDeps,
  appId: string,
  projectId: string,
  mode: PublishMode,
): Promise<{ appId: string; revision: number } | 'conflict' | null> {
  const draft = await store.meta(appId)
  const head = draft?.taskId ? await store.revision(appId, draft.head) : null
  if (!draft?.taskId || !head) return null
  const existing = mode === 'new' ? null : await liveTarget(store, draft, projectId)
  const target = existing ?? (await store.create({ projectId }, draft.name, draft.description))
  let revision: number
  try {
    revision = await store.publish(
      target.appId,
      head.files,
      {
        note: head.meta.note,
        library: head.meta.library,
        publishedFrom: {
          taskId: draft.taskId,
          appId,
          revision: draft.head,
          ...(draft.sessionId ? { sessionId: draft.sessionId } : {}),
        },
      },
      existing && mode === 'safe' ? { expectedHead: draft.draftOf!.revision } : {},
    )
  } catch (error) {
    if (error instanceof AppConflict) return 'conflict'
    throw error
  }
  // A new project app starts with the draft's state. An existing one keeps its own, which other
  // people may have changed.
  if (!existing) await store.saveState(target.appId, await store.state(appId))
  await store.update(appId, { draftOf: { appId: target.appId, revision, head: draft.head } })
  changed(target)
  changed(draft)
  return { appId: target.appId, revision }
}

/** A draft of a project app in a task of the same project, made from the project app's head and state.
 *  A task that already has a draft of it gets that one. Null when the app isn't a live project app of
 *  the task's project. */
export async function startDraft(
  { store, changed }: ProjectAppDeps,
  appId: string,
  task: { id: string; projectId: string },
): Promise<AppMeta | null> {
  const target = await store.meta(appId)
  if (!target?.projectId || target.deletedAt || target.projectId !== task.projectId) return null
  const existing = (await store.forTask(task.id)).find((meta) => meta.draftOf?.appId === appId)
  if (existing) return existing
  const head = await store.revision(appId, target.head)
  if (!head) return null
  const draft = await store.create({ taskId: task.id }, target.name, target.description)
  await store.publish(
    draft.appId,
    head.files,
    { note: `Draft of v${target.head}.`, library: head.meta.library },
    { toWorking: true },
  )
  await store.saveState(draft.appId, await store.state(appId))
  await store.update(draft.appId, { draftOf: { appId, revision: target.head, head: 1 } })
  const meta = (await store.meta(draft.appId))!
  changed(meta)
  return meta
}
