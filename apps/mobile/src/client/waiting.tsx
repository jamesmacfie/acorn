import { createContext, createMemo, useContext, type ParentProps } from 'solid-js'
import { createAttentionInbox, type AttentionInbox } from '@acorn/client-core/features/notifications'
import { workspaceForProject } from '@acorn/client-core/features/workspaces'
import type { Task, Workspace } from '@acorn/client-core/infra/queries.ts'
import { rosterReady } from './roster'

export type WaitingRow = AttentionInbox['rows'][number]

const Waiting = createContext<() => WaitingRow[]>(() => [])

/** The desktop bell's inbox, made once for every screen. It reads the registered attention sources
 *  once, when it is made, so it waits for the roster. */
export function WaitingProvider(props: ParentProps) {
  const inbox = createMemo(() => (rosterReady() ? createAttentionInbox() : undefined))
  return <Waiting.Provider value={() => inbox()?.().rows ?? []}>{props.children}</Waiting.Provider>
}

/** Every row that waits on someone, across the Node. */
export const useWaiting = () => useContext(Waiting)

/** A row that names neither a task nor a project is about the Node, and waits in no workspace. */
export const waitsOnNode = (row: WaitingRow) => !row.item.taskId && !row.item.projectId

/** The ID of the workspace a row waits in: its task's project's, or else its project's. */
export function waitingWorkspaceId(
  row: WaitingRow,
  tasks: Task[] | undefined,
  workspaces: Workspace[] | undefined,
): string | undefined {
  const projectId = row.item.taskId ? tasks?.find((task) => task.id === row.item.taskId)?.projectId : row.item.projectId
  return workspaceForProject(workspaces, projectId)?.id
}
