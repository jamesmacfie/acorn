import { createMemo, createSignal, For, Show } from 'solid-js'
import type { NodePluginPermissions } from '@acorn/protocol/api.ts'
import { nodes } from '../node/fleet'
import { createDismissable } from '../ui/dismissable'
import { noteBundleAccepted, pendingTrust, resolvePendingTrust, type PluginTrustRequest } from './distribution'
import { nodePermissionLines, uiPermissionLines } from './permissions'
import { syncChromeContributions } from './chrome/register'
import { syncFrameContributions } from './frames/register'
import { recordPluginTrust } from './host'
import './plugin-trust.css'

// The consent surface for running code a node handed this device
// (docs/plugins.md).
//
// Modelled on ConfigTrustDialog: same overlay slot, same alertdialog semantics, same "Not now"
// escape. The difference is scope. Config trust binds a project to the hash of a config the NODE will
// execute; this binds a plugin to the hash of a bundle THIS DEVICE will execute, which is why the
// acknowledgement lives beside the device token rather than in the node's database and why pairing a
// new laptop asks again.
//
// The wording says DECLARED, not enforced, everywhere permissions appear. Until loaded plugins move
// out of process, the node block shapes a plugin's `ctx` and is disclosed — it does not contain a
// bundle that simply imports `node:fs` (docs/security.md § Design rules, rule 6).
// The same UI flips to "enforced" with no vocabulary change when that boundary lands, which is the
// payoff for being blunt about it now.

export default function PluginTrustDialog() {
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')

  const request = (): PluginTrustRequest | undefined => pendingTrust()[0]
  const nodeLabel = (nodeId: string) => nodes().find((node) => node.nodeId === nodeId)?.label ?? nodeId

  // On an update, everything the plugin did NOT have before is marked. An unchanged permission set
  // renders plain, so "nothing new is being asked for" reads at a glance.
  const group = (project: (permissions: NodePluginPermissions) => string[]) =>
    createMemo(() => {
      const current = request()
      if (!current?.row.installed) return []
      const before = current.previous ? new Set(project(current.previous.permissions)) : null
      return project(current.row.installed.permissions).map((text) => ({ text, added: before ? !before.has(text) : false }))
    })

  const nodeLines = group(nodePermissionLines)
  const uiLines = group(uiPermissionLines)

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
      // An acceptance is what lets the plugin's surfaces exist at all (frames/register.tsx gates on it), so
      // register them now rather than at the next boot. A rejection needs no counterpart: nothing was
      // registered to take away.
      if (decision === 'accepted') {
        noteBundleAccepted(current.row.name, current.hash)
        syncFrameContributions()
        // A bundle-bearing plugin's chrome is gated on the same acceptance, so it appears with the rest of
        // its surfaces rather than at the next boot (chrome/register.ts states the gate).
        syncChromeContributions()
      }
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
              <Show when={error()}><div class="action-error" role="alert">{error()}</div></Show>

              <h3>On the node — declared, not enforced</h3>
              <Show when={nodeLines().length} fallback={<p class="muted">Nothing declared.</p>}>
                <ul class="plugin-trust-permissions">
                  <For each={nodeLines()}>{(line) => <li classList={{ added: line.added }}>{line.text}</li>}</For>
                </ul>
              </Show>
              {/* The canonical wording, verbatim from docs/security.md. It is the whole
                  truth about the list above and it must not be softened: this is the one sentence
                  standing between an owner and a plugin that reads ~/.ssh. */}
              <p class="muted">This plugin's server code runs with the same access as acorn itself.</p>

              <h3>In this app — enforced</h3>
              <Show when={uiLines().length} fallback={<p class="muted">Nothing declared.</p>}>
                <ul class="plugin-trust-permissions">
                  <For each={uiLines()}>{(line) => <li classList={{ added: line.added }}>{line.text}</li>}</For>
                </ul>
              </Show>
              <p class="muted">
                Its interface runs in a sandbox with no network of its own. Anything not listed here is
                refused.
              </p>
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
