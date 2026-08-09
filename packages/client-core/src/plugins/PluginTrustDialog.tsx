import { createMemo, createSignal, For, Show } from 'solid-js'
import type { NodePluginPermissions } from '@acorn/protocol/api.ts'
import { nodes } from '../node/fleet'
import { createDismissable } from '../ui/dismissable'
import { pendingTrust, resolvePendingTrust, type PluginTrustRequest } from './distribution'
import { recordPluginTrust } from './host'
import './plugin-trust.css'

// The consent surface for running code a node handed this device
// (docs/third-party/phase-2-distribution-trust.md § Trust store).
//
// Modelled on ConfigTrustDialog: same overlay slot, same alertdialog semantics, same "Not now"
// escape. The difference is scope. Config trust binds a project to the hash of a config the NODE will
// execute; this binds a plugin to the hash of a bundle THIS DEVICE will execute, which is why the
// acknowledgement lives beside the device token rather than in the node's database and why pairing a
// new laptop asks again.
//
// The wording says DECLARED, not enforced, everywhere permissions appear. Until loaded plugins move
// out of process, the node block shapes a plugin's `ctx` and is disclosed — it does not contain a
// bundle that simply imports `node:fs` (docs/third-party/node-security.md § Design rules, rule 6).
// The same UI flips to "enforced" with no vocabulary change when that boundary lands, which is the
// payoff for being blunt about it now.

// Flattened for display and for diffing. `node:` -prefixed entries are listed first and separately
// because they are the ones that describe reach outside acorn.
const permissionLines = (permissions: NodePluginPermissions): string[] => [
  ...(permissions.node.secrets ? ['node: read provider secrets'] : []),
  ...(permissions.node.exec ? ['node: run commands on the node'] : []),
  ...permissions.node.net.map((host) => `node: reach ${host}`),
  ...permissions.node.core.map((facet) => `node: core.${facet}`),
  ...permissions.node.capabilities.map((id) => `node: capability ${id}`),
  ...permissions.api.map((route) => `api: ${route}`),
  ...permissions.events.map((event) => `events: ${event}`),
]

export default function PluginTrustDialog() {
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')

  const request = (): PluginTrustRequest | undefined => pendingTrust()[0]
  const nodeLabel = (nodeId: string) => nodes().find((node) => node.nodeId === nodeId)?.label ?? nodeId

  const lines = createMemo(() => {
    const current = request()
    if (!current?.row.installed) return []
    const now = permissionLines(current.row.installed.permissions)
    const before = current.previous ? new Set(permissionLines(current.previous.permissions)) : null
    // On an update, everything the plugin did NOT have before is marked. An unchanged permission set
    // renders plain, so "nothing new is being asked for" reads at a glance.
    return now.map((text) => ({ text, added: before ? !before.has(text) : false }))
  })

  const decide = async (decision: 'accepted' | 'rejected') => {
    const current = request()
    if (!current?.row.installed) return
    setSaving(true)
    setError('')
    try {
      await recordPluginTrust({
        pluginId: current.row.name,
        hash: current.hash,
        nodeId: current.nodeId,
        version: current.row.installed.version,
        permissions: current.row.installed.permissions,
        decision,
      })
      resolvePendingTrust(current.row.name, current.hash)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the decision.')
    } finally {
      setSaving(false)
    }
  }

  let dialog!: HTMLElement
  // Dismissing is "not now", never "yes". A prompt the owner clicked past re-appears at the next
  // boot, because nothing has been decided.
  const dismiss = createDismissable({ onDismiss: () => void decide('rejected'), container: () => dialog })

  return (
    <Show when={request()}>
      {(current) => (
        <div class="overlay-backdrop">
          <section
            ref={dialog}
            class="overlay plugin-trust-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="plugin-trust-title"
            onClick={dismiss.onContainerClick}
            onKeyDown={dismiss.onKeyDown}
          >
            <div class="overlay-title" id="plugin-trust-title">
              {current().previous ? 'A plugin has been updated' : 'Run a plugin from this node?'}
            </div>
            <div class="overlay-body plugin-trust-body">
              <p>
                <strong>{current().row.name}</strong> <span class="muted">{current().row.installed?.version}</span>
                {' came from '}
                <strong>{nodeLabel(current().nodeId)}</strong>.
                <Show when={current().previous}>
                  {(previous) => <> You last approved version {previous().version}.</>}
                </Show>
              </p>
              <p class="muted">
                Its code runs on this device and inside the node. acorn shows what it declared; nothing here is
                enforced yet, so trust it only if you trust whoever published it.
              </p>
              <Show when={error()}><div class="action-error" role="alert">{error()}</div></Show>
              <h3>Declared permissions</h3>
              <Show when={lines().length} fallback={<p class="muted">None declared.</p>}>
                <ul class="plugin-trust-permissions">
                  <For each={lines()}>{(line) => <li classList={{ added: line.added }}>{line.text}</li>}</For>
                </ul>
              </Show>
            </div>
            <div class="overlay-actions">
              <button type="button" class="ui-btn" data-variant="ghost" disabled={saving()} onClick={() => void decide('rejected')}>
                Don't run it
              </button>
              <button type="button" class="ui-btn" disabled={saving()} onClick={() => void decide('accepted')}>
                {saving() ? 'Saving…' : current().previous ? 'Trust the update' : 'Trust this plugin'}
              </button>
            </div>
          </section>
        </div>
      )}
    </Show>
  )
}
