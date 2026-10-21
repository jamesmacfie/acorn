import { resolveRailMarkers } from '@acorn/client-core/features/tabs'
import { markersFor } from '@acorn/client-core/host/registries/rail'

/** A task's state in words: what the desktop's rail markers say about it, such as an agent working
 *  or a change request's checks failing. Empty when nothing does. */
export const taskState = (taskId: string): string =>
  resolveRailMarkers(markersFor({ kind: 'task', id: taskId }))
    .legend.map((item) => item.l)
    .join(' · ')
