import type { BridgeAppSummary } from '@acorn/protocol/extensionBridge.ts'

// The trellis plugin's app routes and bodies, narrowed to what the sidebar's app card draws. No code
// from that plugin: its route shapes are in its own `shared/api.ts`, which isn't a contract.
// docs/browser-extension/native-messaging.md § App cards.

const appsRoute = '/v1/p/trellis/apps'
export const appRoute = (appId: string) => `${appsRoute}/${encodeURIComponent(appId)}`
export const appRevisionRoute = (appId: string, revision: number) => `${appRoute(appId)}/revisions/${revision}`
export const appStateRoute = (appId: string) => `${appRoute(appId)}/state`
export const appRestoreRoute = (appId: string) => `${appRoute(appId)}/restore`

/** An app's summary. A task app names its task. */
export type AppSummaryBody = BridgeAppSummary & { taskId?: string }
/** One revision's program and parsed plans, by plan name. */
export type AppRevisionBody = { program: string; plans: Record<string, unknown> }

export const bridgeAppSummary = (summary: AppSummaryBody): BridgeAppSummary => ({
  appId: summary.appId,
  name: summary.name,
  head: summary.head,
  revisions: summary.revisions.map(({ revision, note, restoredFrom }) => ({
    revision,
    note,
    ...(restoredFrom ? { restoredFrom } : {}),
  })),
})

const KEPT_REVISIONS = 8

/** The files of the last few revisions read, by Node, app, and revision. A revision never changes, so
 *  a program's runs skip a read. */
export function revisionFiles(read: (nodeId: string, appId: string, revision: number) => Promise<AppRevisionBody>) {
  const kept = new Map<string, AppRevisionBody>()
  return async (nodeId: string, appId: string, revision: number): Promise<AppRevisionBody> => {
    const key = JSON.stringify([nodeId, appId, revision])
    const files = kept.get(key) ?? (await read(nodeId, appId, revision))
    kept.delete(key)
    kept.set(key, files)
    if (kept.size > KEPT_REVISIONS) kept.delete(kept.keys().next().value!)
    return files
  }
}
