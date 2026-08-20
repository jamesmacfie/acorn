import { createResource, createSignal, For, Show } from 'solid-js'
import { corePluginsRoute, type NodePluginState, type PluginApprovalRequest } from '@acorn/protocol/api.ts'
import { readJson } from '../apiClient'
import { activeNodeId } from '../node/activeNode'
import { nodes } from '../node/fleet'
import {
  answerPluginRequest,
  installNodePlugin,
  refreshNodePlugins,
  reloadNodePlugin,
  uninstallNodePlugin,
  updateNodePlugin,
} from '../node/nodePlugins'
import Icon from '../ui/Icon'
import { createDismissable } from '../ui/dismissable'
import { Alert, Badge, Button } from '../ui/primitives'
import { closePluginApproval, describePluginRequest, pluginApprovalTask, pluginRequestOutcomeMessage } from './approval'
import { syncPluginDistribution } from './distribution'
import { setPluginDevGrant } from './host'
import { nodePermissionLines, scheduleGrants, schedulePermissionLines, uiPermissionLines, webviewGrants, webviewPermissionLines } from './permissions'
import './plugin-trust.css'

// The owner's side of an agent's install request (docs/plugins.md § Approval-mediated install and
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
    const installed = reviewRow()?.installed
    if (!installed) return []
    return [
      ...nodePermissionLines(installed.permissions),
      // The node half is what this screen exists for, and a schedule is the part of it that acts with
      // nobody here, so it belongs on the one disclosure a node-only package ever gets.
      ...schedulePermissionLines(scheduleGrants(installed.contributions)),
      ...uiPermissionLines(installed.permissions),
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
        const result = await updateNodePlugin(current.pluginId!, {}, nodeId() ?? undefined)
        setLanded({ pluginId: result.id, version: result.toVersion })
      } else {
        const result = await installNodePlugin(current.source!, {}, nodeId() ?? undefined)
        setLanded({ pluginId: result.id, version: result.version })
      }
      await refetch()
      setScreen('review')
    })

  // The second No. Nothing has run (install never starts a plugin), so removing the package leaves the
  // node exactly as it was, minus a directory. Its database is kept, which is what every other uninstall
  // path in the product does by default.
  const removeIt = () =>
    run(async () => {
      const current = request()
      const target = landed()
      if (!current || !target) return
      await uninstallNodePlugin(target.pluginId, {}, nodeId() ?? undefined)
      await finish(current, 'denied', pluginRequestOutcomeMessage(current, { decision: 'denied', removed: true }))
    })

  const enableIt = () =>
    run(async () => {
      const current = request()
      const target = landed()
      if (!current || !target) return
      // The dev grant is recorded before the distribution pass, because the pass is what fetches the
      // bundle and main applies the grant as the bytes land (main/pluginIpc.ts). The other order would
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
      let reloaded = false
      if (current.dev) {
        try {
          reloaded = (await reloadNodePlugin(target.pluginId, nodeId() ?? undefined)).state === 'reloaded'
        } catch {
          reloaded = false
        }
      }
      await refreshNodePlugins(nodeId() ?? undefined)
      await finish(current, 'approved', pluginRequestOutcomeMessage(current, { decision: 'approved', version: target.version, reloaded }))
    })

  let dialog!: HTMLElement
  // Escape is "not now" and records nothing, exactly as it does in the bundle trust prompt: the request
  // stays in the node's queue, the bell still points at it, and an owner who wants to read the package
  // before answering is not trapped in a modal.
  //
  // Escaping the review screen leaves the package installed and unreviewed, which lands the owner exactly
  // where a hand-typed install in Settings → Plugins leaves them: its client half still faces the
  // per-hash prompt, and its node half starts at the next node restart. That is the pre-existing floor,
  // not a hole this dialog opened, and it is why the screen is an improvement rather than a fence.
  const dismiss = createDismissable({ onDismiss: () => { reset(); closePluginApproval() }, container: () => dialog })

  return (
    <Show when={request()}>
      {(current) => (
          <div class="overlay-backdrop" onClick={dismiss.onBackdropClick}>
            <section
              ref={(el) => {
                dialog = el
                queueMicrotask(() => el.focus())
              }}
              tabindex="-1"
              class="overlay plugin-trust-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="plugin-approval-title"
              onClick={dismiss.onContainerClick}
              onKeyDown={dismiss.onKeyDown}
            >
              <div class="overlay-title">{screen() === 'ask' ? 'An agent wants to change acorn' : 'Review what it declares'}</div>
              <div class="overlay-body plugin-trust-body">
                <header class="plugin-trust-identity">
                  <span class="plugin-trust-glyph" aria-hidden="true"><Icon name="puzzle" /></span>
                  <div>
                    <h2 id="plugin-approval-title">{describePluginRequest(current())}</h2>
                    <p class="plugin-trust-meta">
                      <Badge size="xs"><Icon name="monitor" /> on {nodeLabel()}</Badge>
                      <Show when={current().dev}><Badge size="xs" tone="warn">development mode</Badge></Show>
                    </p>
                  </div>
                </header>

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
                    Nothing has been downloaded. acorn can’t show you what this package declares until it has
                    it — approving fetches and unpacks it, runs none of it, and then shows you exactly what it
                    asks for before anything starts.
                  </p>
                  <Show when={current().dev}>
                    <p class="muted plugin-trust-intro">
                      <strong>Development mode</strong> means later versions of this plugin from{' '}
                      {nodeLabel()} are trusted on this device without asking again, so the agent can edit and
                      reload it. Its server code runs with the same access as acorn itself, each time, without
                      you reading it. End it from Settings → Plugins whenever you like.
                    </p>
                  </Show>
                </Show>

                <Show when={screen() === 'review'}>
                  <p class="muted plugin-trust-intro">
                    <code>{landed()?.pluginId}</code> {landed()?.version} is on {nodeLabel()}’s disk and none of it
                    has run. This is what it says it touches.
                  </p>
                  <ul class="plugin-trust-permissions" data-tier="declared">
                    <For each={declared()} fallback={<li><Icon name="circle" /><span>It declares nothing at all.</span></li>}>
                      {(line) => (
                        <li classList={{ high: line.high }}>
                          <Icon name={line.icon} />
                          <span>{line.text}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                  <p class="muted plugin-trust-legend">
                    <span class="plugin-trust-plain">This plugin’s server code runs with the same access as acorn itself.</span>{' '}
                    The list above is the plugin’s own description of what it touches; acorn can’t check it.
                  </p>
                </Show>
              </div>
              <div class="ui-modal-actions plugin-trust-actions">
                <Show
                  when={screen() === 'review'}
                  fallback={
                    <>
                      <Button variant="ghost" disabled={busy()} onClick={() => void deny()}>
                        Deny
                      </Button>
                      <Button disabled={busy()} onClick={() => void approve()}>
                        {busy() ? 'Working…' : current().action === 'uninstall' ? 'Remove it' : 'Fetch it'}
                      </Button>
                    </>
                  }
                >
                  <Button variant="ghost" tone="danger" disabled={busy()} onClick={() => void removeIt()}>
                    Remove it
                  </Button>
                  <Button disabled={busy()} onClick={() => void enableIt()}>
                    {busy() ? 'Working…' : current().dev ? 'Trust and develop' : 'Keep it'}
                  </Button>
                </Show>
              </div>
            </section>
          </div>
      )}
    </Show>
  )
}
