import { createSignal, For, Match, Show, Switch } from 'solid-js'
import type { NodeProbeResult } from '@acorn/protocol/broker.ts'
import { nodes, nodeStatus } from '../node/fleet'
import { fleetMutable, pairNode, probeNodeEndpoint, reconnectNode, removeNode, renameNode } from '../node/fleetActions'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import NodeChip from '../node/NodeChip'
import '../node/nodes.css'
import { Alert } from '../ui/primitives'

// Settings → Nodes (docs/ui-design.md § Node management): add, rename, reconnect, unpair, revoke.
//
// ONE component with three inline steps rather than a wizard framework. The steps are not a UX
// flourish — step 2 exists because comparing the fingerprint against the one the node itself displays
// IS the security of pairing (docs/api-reference.md § Pairing). Making it a deliberate screen with the
// value in front of the owner, rather than a checkbox next to a URL field, is the whole point; a
// checkbox is a thing people tick.
type Step = { kind: 'idle' } | { kind: 'endpoint' } | { kind: 'confirm'; probe: NodeProbeResult } | { kind: 'code'; probe: NodeProbeResult }

const defaultDeviceName = (): string => {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform
  return platform ? `acorn on ${platform}` : 'acorn desktop'
}

export default function NodesSettings() {
  const [step, setStep] = createSignal<Step>({ kind: 'idle' })
  const [endpoint, setEndpoint] = createSignal('https://')
  const [code, setCode] = createSignal('')
  const [deviceName, setDeviceName] = createSignal(defaultDeviceName())
  const [label, setLabel] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [renaming, setRenaming] = createSignal<string | null>(null)
  const [renameValue, setRenameValue] = createSignal('')

  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(false)
    }
  }

  const probe = () => run(async () => {
    const result = await probeNodeEndpoint(endpoint().trim())
    setLabel(new URL(result.endpoint).hostname)
    setStep({ kind: 'confirm', probe: result })
  })

  const pair = (probed: NodeProbeResult) => run(async () => {
    await pairNode({ code: code().trim(), deviceName: deviceName().trim(), label: label().trim() || probed.endpoint })
    setStep({ kind: 'idle' })
    setCode('')
  })

  const cancel = () => {
    setStep({ kind: 'idle' })
    setCode('')
    setError('')
  }

  return (
    <div class="nodes-settings">
      <Show
        when={fleetMutable()}
        fallback={
          // `dev:node` in a browser: the serving origin IS the node, there is no broker to hold a
          // pinned certificate, and so there is no fleet to manage.
          <p class="muted">This build talks to a single node directly and has no fleet to manage.</p>
        }
      >
        <div class="nodes-list">
          <For each={nodes()}>
            {(node) => {
              const status = () => nodeStatus(node.nodeId)
              const mismatch = () => status()?.error?.code === 'identity_mismatch'
              return (
                <div class="node-row" classList={{ 'node-row-alarm': mismatch() }}>
                  <div class="node-meta">
                    <Show
                      when={renaming() === node.nodeId}
                      fallback={
                        <span class="node-title">
                          {node.label}
                          <Show when={node.local}><span class="node-badge">This computer</span></Show>
                        </span>
                      }
                    >
                      <input
                        class="ui-input node-rename"
                        value={renameValue()}
                        ref={(el) => queueMicrotask(() => el.focus())}
                        onInput={(event) => setRenameValue(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setRenaming(null)
                          if (event.key !== 'Enter') return
                          const next = renameValue().trim()
                          setRenaming(null)
                          if (next && next !== node.label) void run(() => renameNode(node.nodeId, next))
                        }}
                      />
                    </Show>
                    <span class="node-sub">{node.endpoint}</span>
                    <NodeChip nodeId={node.nodeId} query={{}} />
                  </div>

                  {/* A fingerprint mismatch is a hard stop. The broker has stopped reconnecting; the
                      owner must forget and pair the node again after verifying its identity. */}
                  <Show when={mismatch()}>
                    <div class="node-alarm">
                      <strong>This node's identity changed.</strong>
                      <p>
                        acorn stopped connecting and will not trust the new certificate on its own. Either this node was
                        rebuilt — in which case unpair it and pair again, checking the fingerprint it displays — or
                        something is intercepting the connection.
                      </p>
                      <dl class="node-fingerprints">
                        <dt>Pinned</dt>
                        <dd>
                          <span class="node-fingerprint-words">{fingerprintPhrase(node.fingerprint) ?? 'unknown'}</span>
                          <span class="node-fingerprint-hex">{node.fingerprint ?? 'unknown'}</span>
                        </dd>
                        <Show when={status()?.error?.presentedFingerprint}>
                          {(presented) => (
                            <>
                              <dt>Presented</dt>
                              <dd>
                                <span class="node-fingerprint-words">{fingerprintPhrase(presented()) ?? 'unknown'}</span>
                                <span class="node-fingerprint-hex">{presented()}</span>
                              </dd>
                            </>
                          )}
                        </Show>
                      </dl>
                    </div>
                  </Show>

                  <div class="node-actions">
                    <button type="button" class="ui-btn" disabled={busy()} onClick={() => reconnectNode(node.nodeId)}>Reconnect</button>
                    <button
                      type="button"
                      class="ui-btn"
                      disabled={busy()}
                      onClick={() => { setRenameValue(node.label); setRenaming(node.nodeId) }}
                    >
                      Rename
                    </button>
                    {/* Labelled distinctly on purpose (docs/ui-design.md § Node management). Confusing the two is
                        how an owner loses access to a remote node: unpair is recoverable with the same
                        pairing code, revoke means the node has torn up this client's credential. */}
                    <Show when={!node.local}>
                      <button
                        type="button"
                        class="ui-btn"
                        disabled={busy()}
                        title="This client forgets the node. The node keeps this device paired."
                        onClick={() => void run(() => removeNode(node.nodeId, false))}
                      >
                        Unpair…
                      </button>
                      <button
                        type="button"
                        class="ui-btn node-danger"
                        disabled={busy()}
                        title="The node forgets this client. You will need a new pairing code to come back."
                        onClick={() => void run(() => removeNode(node.nodeId, true))}
                      >
                        Revoke this client…
                      </button>
                    </Show>
                  </div>
                </div>
              )
            }}
          </For>
        </div>

        <Switch>
          <Match when={step().kind === 'idle'}>
            <button type="button" class="ui-btn nodes-add-btn" onClick={() => setStep({ kind: 'endpoint' })}>
              <span class="integration-add-icon">+</span> Add a node
            </button>
          </Match>

          <Match when={step().kind === 'endpoint'}>
            <div class="node-step">
              <label class="node-step-label">
                Node address
                <input
                  class="ui-input"
                  value={endpoint()}
                  placeholder="https://host:port"
                  ref={(el) => queueMicrotask(() => el.focus())}
                  onInput={(event) => setEndpoint(event.currentTarget.value)}
                  onKeyDown={(event) => event.key === 'Enter' && void probe()}
                />
                <p class="muted">The address the node prints when it starts. https only — the certificate is the identity.</p>
              </label>
              <div class="node-step-actions">
                <button type="button" class="ui-btn" disabled={busy()} onClick={() => void probe()}>{busy() ? 'Contacting…' : 'Continue'}</button>
                <button type="button" class="ui-btn" onClick={cancel}>Cancel</button>
              </div>
            </div>
          </Match>

          <Match when={step().kind === 'confirm' && step()}>
            {(current) => {
              const probed = () => (current() as Extract<Step, { kind: 'confirm' }>).probe
              return (
                <div class="node-step">
                  <strong>Does the node display this fingerprint?</strong>
                  <p class="muted">
                    Compare it with the value shown on {probed().endpoint} itself. This comparison is the only thing that
                    proves you are pairing with your node and not with something in between — acorn cannot check it for you.
                  </p>
                  {/* Words first, hex second. Two 64-character hex strings differing in the middle look
                      identical to a person, which is exactly the substitution an attacker wants — so the
                      phrase is what the owner is asked to compare, and the hex stays for anyone who would
                      rather paste and diff it exactly (@acorn/protocol/fingerprintWords.ts). */}
                  <Show when={fingerprintPhrase(probed().fingerprint)}>
                    {(phrase) => <code class="node-fingerprint node-fingerprint-words">{phrase()}</code>}
                  </Show>
                  <code class="node-fingerprint node-fingerprint-hex">{probed().fingerprint}</code>
                  <Show when={!probed().compatible}>
                    <Alert>
                      This node speaks protocol v{probed().protocolVersion}; this app speaks v{NODE_PROTOCOL_VERSION}.
                      Upgrade whichever is older before pairing.
                    </Alert>
                  </Show>
                  <div class="node-step-actions">
                    <button
                      type="button"
                      class="ui-btn"
                      disabled={!probed().compatible}
                      onClick={() => setStep({ kind: 'code', probe: probed() })}
                    >
                      It matches
                    </button>
                    <button type="button" class="ui-btn" onClick={cancel}>It does not — stop</button>
                  </div>
                </div>
              )
            }}
          </Match>

          <Match when={step().kind === 'code' && step()}>
            {(current) => {
              const probed = () => (current() as Extract<Step, { kind: 'code' }>).probe
              return (
                <div class="node-step">
                  <label class="node-step-label">
                    Pairing code
                    <input
                      class="ui-input"
                      value={code()}
                      ref={(el) => queueMicrotask(() => el.focus())}
                      onInput={(event) => setCode(event.currentTarget.value)}
                      onKeyDown={(event) => event.key === 'Enter' && void pair(probed())}
                    />
                    <p class="muted">Start pairing on the node to get a code. It expires shortly and allows a few attempts.</p>
                  </label>
                  <label class="node-step-label">
                    This device's name
                    <input class="ui-input" value={deviceName()} onInput={(event) => setDeviceName(event.currentTarget.value)} />
                  </label>
                  <label class="node-step-label">
                    Name for this node
                    <input class="ui-input" value={label()} onInput={(event) => setLabel(event.currentTarget.value)} />
                  </label>
                  <div class="node-step-actions">
                    <button type="button" class="ui-btn" disabled={busy() || !code().trim()} onClick={() => void pair(probed())}>
                      {busy() ? 'Pairing…' : 'Pair'}
                    </button>
                    <button type="button" class="ui-btn" onClick={cancel}>Cancel</button>
                  </div>
                </div>
              )
            }}
          </Match>
        </Switch>

        <Show when={error()}><Alert>{error()}</Alert></Show>
      </Show>
    </div>
  )
}
