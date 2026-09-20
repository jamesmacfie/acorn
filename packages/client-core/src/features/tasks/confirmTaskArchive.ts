import { confirmWillEvent, type WillDecision } from '../../host/registries/shell/willPhase'

/** Task archive is destructive enough to require an explicit decision even when no plugin reports a
 * concern. Plugin concerns still populate the same dialog and return any selected cleanups. */
export const confirmTaskArchive = (taskId: string): Promise<WillDecision> => confirmWillEvent({
  kind: 'task:archive',
  payload: { taskId },
  title: 'Archive task',
  actionLabel: 'Archive task',
  message: 'Are you sure you want to archive this task?',
  alwaysConfirm: true,
})
