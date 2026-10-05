import { Portal } from 'solid-js/web'
import { createResource, createSignal, For, Show } from 'solid-js'
import { corePluginsRoute, type NodePluginState, type PluginApprovalRequest } from '@acorn/protocol/api.ts'
import { readJson } from '../../infra/node/apiClient'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodes } from '../../infra/node/fleet'
import {
  answerPluginRequest,
  grantPluginInputs,
  installNodePlugin,
  refreshNodePlugins,
  reloadNodePlugin,
  reviewNodePlugin,
  uninstallNodePlugin,
  updateNodePlugin,
} from '../../infra/node/nodePlugins'
import Icon from '../../kit/components/content/Icon'
import { Alert, Badge, Button, SectionHeader, ToolbarSpacer } from '../../kit/components/primitives'
import { Modal } from '../../kit/components/overlays/Modal'
import { closePluginApproval, describePluginRequest, pluginApprovalTask, pluginRequestOutcomeMessage } from './approval'
import { syncPluginDistribution } from '../plugins/distribution'
import { setPluginDevGrant } from '../plugins/host'
import { inputPermissionLines, navigationDestinationGrants, navigationDestinationPermissionLines, nodePermissionLines, providedSourceLines, scheduleGrants, schedulePermissionLines, uiPermissionLines, webviewGrants, webviewPermissionLines } from './permissions'
import { shownInputs } from './trustModel'
import './plugin-trust.css'

// The owner's side of an agent's install request (docs/plugins/agent-install.md § Approval-mediated install and
// § What the owner can know before the download own the two-screen design and why the split exists).
//
// Drawn in the shell, in the overlay slot beside the two other trust prompts, which is the part that
// matters most: a plugin frame is an iframe inside a pane and can never paint over this. The agent that
// raised the request holds a task-scoped internal token and cannot reach the install route, the roster
// route, or the decision route below: every one of them is device-only by mount.

type Screen = 'ask' | 'review'

export default function PluginApprovalDialog() {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [screen, setScreen] = createSignal<Screen>('ask')
  // Which plugin id the install produced, so the review screen can find its roster row. For an update it
  // is known up front; for an install only the node can say.
  const [landed, setLanded] = createSignal<{ pluginId: string; version: string } | null>(null)

  const nodeId = () => activeNodeId()
  const nodeLabel = () => nodes().find((node) => node.nodeId === nodeId())?.label ?? nodeId() ?? 'this node'

  // Re-read on every open rather than kept live: the queue only changes when an agent adds to it or this
  // dialog answers, and a request that vanished under the owner mid-read is better handled by the node's
  // 404 than by a subscription.
  const [state, { refetch }] = createResource<NodePluginState | null, string>(
    () => (pluginApprovalTask() ? (nodeId() ?? '') : ''),
    async (id) => (id ? await readJson<NodePluginState>(corePluginsRoute, { nodeId: id }) : null),
  )

  // One at a time, oldest first, filtered to the task the notice named. A queue drained in order is the
  // same shape the bundle trust prompt uses, and it keeps each decision about one thing.
  const request = (): PluginApprovalRequest | undefined =>
    (state()?.requests ?? []).filter((entry) => entry.taskId === pluginApprovalTask()).sort((a, b) => a.requestedAt - b.requestedAt)[0]

  const reviewRow = () => {
    const id = landed()?.pluginId
    return id ? (state()?.plugins ?? []).find((row) => row.name === id) : undefined
  }
  const declared = () => {
    const row = reviewRow()
    const installed = row?.installed
    if (!row || !installed) return []
    return [
      // The same Reads your data and Provides lines the trust prompt shows, so a plugin an agent wrote
      // can't reach anyone's accounts without saying so. Turning it on approves them.
      ...inputPermissionLines(row.inputs?.inputs ?? []),
      ...providedSourceLines(installed.contributions),
      ...nodePermissionLines(installed.permissions),
      // The node half is what this screen exists for, and a schedule is the part of it that acts with
      // nobody here, so it belongs on the one disclosure a node-only package ever gets.
      ...schedulePermissionLines(scheduleGrants(installed.contributions)),
      ...uiPermissionLines(installed.permissions, row.name),
      ...navigationDestinationPermissionLines(navigationDestinationGrants(installed.contributions)),
      ...webviewPermissionLines(webviewGrants(installed.contributions)),
    ]
  }

  const reset = () => {
    setScreen('ask')
    setLanded(null)
    setError('')
  }

  const finish = async (current: PluginApprovalRequest, decision: 'approved' | 'denied', message: string) => {
    await answerPluginRequest(current.requestId, decision, message, nodeId() ?? undefined)
    reset()
    await refetch()
    // The queue may hold a second request for the same task; the dialog closes only when it is empty.
    if (!request()) closePluginApproval()
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const deny = () =>
    run(async () => {
      const current = request()
      if (!current) return
      await finish(current, 'denied', pluginRequestOutcomeMessage(current, { decision: 'denied' }))
    })

  // The device performs the install, with its own principal, over the same routes Settings → Plugins uses.
  // Nothing about this call path knows an agent was involved.
  const approve = () =>
    run(async () => {
      const current = request()
      if (!current) return
      if (current.action === 'uninstall') {
        await uninstallNodePlugin(current.pluginId!, { purgeData: current.purgeData === true }, nodeId() ?? undefined)
        await finish(current, 'approved', pluginRequestOutcomeMessage(current, { decision: 'approved' }))
        return
      }
      if (current.action === 'update') {
        const result = await updateNodePlugin(current.pluginId!, { reviewRequestId: current.requestId }, nodeId() ?? undefined)
        setLanded({ pluginId: result.id, version: result.toVersion })
      } else {
        const result = await installNodePlugin(current.source!, { reviewRequestId: current.requestId }, nodeId() ?? undefined)
        setLanded({ pluginId: result.id, version: result.version })
      }
      await refetch()
      setScreen('review')
    })

  // The second No. Nothing has run (the durable gate blocks boot and reload), so removing the package leaves the
  // node exactly as it was, minus a directory. Its database is kept, which is what every other uninstall
  // path in the product does by default.
  const removeIt = () =>
    run(async () => {
      const target = landed()
      const pending = reviewRow()?.pendingReview
      if (!target || !pending || !('reviewId' in pending)) return
      await reviewNodePlugin(target.pluginId, pending, 'denied', nodeId() ?? undefined)
      reset()
      await refetch()
      if (!request()) closePluginApproval()
    })

  const enableIt = () =>
    run(async () => {
      const current = request()
      const target = landed()
      const pending = reviewRow()?.pendingReview
      if (!current || !target || !pending || !('reviewId' in pending)) return
      await reviewNodePlugin(target.pluginId, pending, 'approved', nodeId() ?? undefined)
      // The review screen showed what it reads, so turning it on approves that exact list too.
      const shown = reviewRow()
      if (shown?.inputs?.inputs.some((input) => !input.approved)) await grantPluginInputs(target.pluginId, shownInputs(shown), nodeId() ?? undefined)
      // The dev grant is recorded before the distribution pass, because the pass is what fetches the
      // bundle and the helper applies the grant as the bytes land. The other order would
      // queue a trust prompt for the first bundle and auto-trust every one after it.
      if (current.dev) {
        await setPluginDevGrant({
          pluginId: target.pluginId,
          nodeId: nodeId() ?? '',
          ...(current.source && 'path' in current.source ? { path: current.source.path } : {}),
          grant: true,
        })
      }
      await syncPluginDistribution()
      // A dev-mode plugin should not need a restart to be worth iterating on, which is the whole point of
      // the reload path. A built-in or a client-only package has nothing to reload and answers 400; that
      // is not a failure of the approval, so the restart banner covers it instead.
      if (current.dev) {
        try {
          await reloadNodePlugin(target.pluginId, nodeId() ?? undefined)
        } catch {
          // The approval is complete; a failed hot reload leaves restart as the activation path.
        }
      }
      await refreshNodePlugins(nodeId() ?? undefined)
      reset()
      await refetch()
      if (!request()) closePluginApproval()
    })

  // Escape is "not now" and records nothing, exactly as it does in the bundle trust prompt: the request
  // stays in the node's queue, the bell still points at it, and an owner who wants to read the package
  // before answering is not trapped in a modal.
  //
  // Escaping review leaves the candidate held by the Node's durable marker. Settings → Plugins can
  // resume the review after reconnect or restart; neither boot nor reload imports it meanwhile.
  const notNow = () => { reset(); closePluginApproval() }

  // The request is the title, so nothing in the body repeats it. An `alertdialog`, so focus starts on
  // the first footer button that does nothing irreversible: **Deny** or **Remove plugin**, never the
  // download or the switch-on.
  return (
    <Portal>
    <Show when={request()}>
      {(current) => (
        <Modal
          title={screen() === 'ask' ? describePluginRequest(current()) : 'Check what it asks for'}
          role="alertdialog"
          onDismiss={notNow}
        >
          <Modal.Body>
            <p class="plugin-trust-meta">
              <Badge size="xs"><Icon name="monitor" /> on {nodeLabel()}</Badge>
              <Show when={current().dev}><Badge size="xs" tone="warn">development mode</Badge></Show>
            </p>

            <Show when={error()}><Alert>{error()}</Alert></Show>

            <Show when={screen() === 'ask'}>
              {/* The agent's own sentence. Interpolated as text — it is written by a model that may be
                  reading hostile content, and it is capped by the tool's input schema. It explains the
                  request; it is not evidence for it. */}
              <Show when={current().reason}>
                {(reason) => (
                  <blockquote class="plugin-trust-intro">
                    <span class="muted">The agent says:</span> {reason()}
                  </blockquote>
                )}
              </Show>
              <p class="muted plugin-trust-intro">
                Nothing is downloaded yet. If you allow it, acorn downloads the plugin without running it,
                then shows you what it asks for.
              </p>
              <Show when={current().dev}>
                <p class="muted plugin-trust-intro">
                  In development mode, new versions from {nodeLabel()} install without asking, so the agent
                  can edit and reload the plugin. Each version still gets only what it asks for. You can turn
                  this off in Settings, under Plugins.
                </p>
              </Show>
            </Show>

            <Show when={screen() === 'review'}>
              <p class="muted plugin-trust-intro">
                <code>{landed()?.pluginId}</code> {landed()?.version} is downloaded and hasn’t run. Here’s
                what it asks for.
              </p>
              <SectionHeader
                level="sub"
                help="acorn blocks anything not on this list. It can’t check what the plugin does with what it’s allowed."
              >
                What it asks for
              </SectionHeader>
              <ul class="plugin-trust-permissions" data-tier="declared">
                <For each={declared()} fallback={<li><Icon name="circle" /><span>It declares nothing at all.</span></li>}>
                  {(line) => (
                    <li classList={{ high: line.high }}>
                      <Icon name={line.icon} />
                      <span>
                        {line.text}
                        <Show when={line.detail}>{(detail) => <span class="plugin-trust-detail">{detail()}</span>}</Show>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Modal.Body>
          <Modal.Actions>
            <Show
              when={screen() === 'review'}
              fallback={
                <>
                  <Button variant="ghost" disabled={busy()} onPress={() => void deny()}>
                    Deny
                  </Button>
                  <Button variant="solid" disabled={busy()} onPress={() => void approve()}>
                    {busy() ? 'Working…' : current().action === 'uninstall' ? 'Remove plugin' : 'Download'}
                  </Button>
                </>
              }
            >
              <Button variant="ghost" tone="danger" disabled={busy()} onPress={() => void removeIt()}>
                Remove plugin
              </Button>
              <ToolbarSpacer />
              <Button variant="solid" disabled={busy()} onPress={() => void enableIt()}>
                {busy() ? 'Working…' : current().dev ? 'Turn on in development mode' : 'Turn on'}
              </Button>
            </Show>
          </Modal.Actions>
        </Modal>
      )}
    </Show>
    </Portal>
  )
}
