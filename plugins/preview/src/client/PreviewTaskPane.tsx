import { createEffect, createMemo, createResource, createSignal, on, onCleanup } from 'solid-js'
import {
  activeNodeId,
  onPluginFrame,
  previewProxy,
  previewTarget,
  readJson,
  remotePreviewBlocked,
  type PreviewBlockedReason,
  type Task,
} from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import type { PreviewUrlState } from '../contract/urls'
import { previewUrlRoute } from '../shared/api'
import PreviewPane from './PreviewPane'

export function PreviewTaskPane(props: { task: Task }) {
  const taskId = createMemo(() => props.task.id)
  const owner = createMemo(() => ({ taskId: taskId(), nodeId: activeNodeId() }))
  const [resolved, { refetch }] = createResource(owner, async (origin) => ({
    origin,
    state: await readJson<PreviewUrlState | null>(previewUrlRoute(origin.taskId), { nodeId: origin.nodeId }),
  }))
  onCleanup(
    onPluginFrame('preview', pluginChannel('preview', 'url-changed'), (payload) => {
      if ((payload as { taskId?: unknown }).taskId === props.task.id) void refetch()
    }),
  )

  // How the Node's address reaches the native webview: as it is for the local Node, through this computer's
  // listener for a remote Node's own loopback, or not at all (docs/shell/webviews.md § The preview URL).
  const target = createMemo(() => {
    if (resolved.error) return null
    const value = resolved.latest
    const url = value?.origin === owner() && value.state?.taskId === props.task.id ? value.state.url : null
    return url ? previewTarget(url, owner().nodeId) : null
  })

  // A remote Node's app opens through a listener, keyed on what it shows, so a refetch that changes nothing keeps
  // the page as it is.
  type Proxied = { nodeId: string; taskId: string; path: string }
  const proxied = createMemo(
    (): Proxied | null => {
      const value = target()
      return value?.kind === 'proxied' ? { nodeId: value.nodeId, taskId: props.task.id, path: value.path } : null
    },
    null,
    { equals: (a, b) => a?.nodeId === b?.nodeId && a?.taskId === b?.taskId && a?.path === b?.path },
  )
  const [entry, { refetch: reopen }] = createResource(proxied, async (open) => ({
    open,
    url: (await previewProxy()!.open(open.nodeId, open.taskId, open.path)).entry,
  }))

  const loadable = createMemo(() => {
    const value = target()
    if (value?.kind === 'direct') return value.url
    const opened = entry.error ? undefined : entry.latest
    return value?.kind === 'proxied' && opened?.open === proxied() ? opened.url : null
  })

  const blocked = createMemo((): PreviewBlockedReason | null => {
    const value = target()
    if (value) return value.kind === 'blocked' ? value.reason : null
    // No address yet. A remote Node this computer can't show at all says so before there is one.
    return remotePreviewBlocked(owner().nodeId) && !previewProxy() ? 'unsupported' : null
  })

  // A navigation the shell refused, such as a link off the app, until the task or its address changes.
  const [refused, setRefused] = createSignal<string | null>(null)
  createEffect(on(proxied, () => setRefused(null)))
  onCleanup(
    previewProxy()?.onBlocked((state) => {
      if (state.taskId === props.task.id) setRefused(state.url)
    }) ?? (() => {}),
  )

  return (
    <PreviewPane
      taskId={props.task.id}
      projectId={props.task.projectId}
      url={loadable()}
      remoteBlocked={blocked() !== null}
      blockedReason={blocked()}
      blockedNavigation={refused()}
      resolving={resolved.loading || entry.loading}
      resolutionFailed={!!resolved.error || !!entry.error}
      retryResolution={() => {
        void refetch()
        if (entry.error) void reopen()
      }}
    />
  )
}
