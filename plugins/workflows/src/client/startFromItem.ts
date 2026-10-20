// "Start workflow…" on a Rollbar error, a Linear issue or a GitHub pull request: what the row menu
// asks for (docs/workflows/starting-runs.md § Starting a run). What the item fills in is
// plugins/workflows/src/contract/itemInputs.ts, and the box the ask opens is `StartFromItemHost`.
import { createSignal } from 'solid-js'
import type { ItemRowTarget } from '@acorn/plugin-api/client'
import type { DataRecord } from '@acorn/protocol/dataSources.ts'

/** Source-aware callers preserve the record envelope and its host-bound identity. */
export type WorkflowSourceItemTarget = ItemRowTarget & { record?: DataRecord }

/** The row menu's ask, held until the overlay draws it. One at a time: a second right-click replaces
 *  the first rather than stacking two modals. */
const [pending, setPending] = createSignal<WorkflowSourceItemTarget | null>(null)

export const startFromItemTarget = pending

export const closeStartFromItem = (): void => {
  setPending(null)
}

export const openStartFromItem = (target: WorkflowSourceItemTarget): void => {
  setPending(target)
}
