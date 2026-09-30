import { createSignal, For, Match, Show, Switch } from 'solid-js'
import type { NodeProbeResult, NodeRecord } from '@acorn/protocol/broker.ts'
import { nodes, nodeStatus } from '../../../infra/node/fleet'
import { attachmentOf, createAttachments, detachNode } from '../../../infra/node/attachment'
import ProvidedNodes from './ProvidedNodes'
import { fleetMutable, pairNode, probeNodeEndpoint, reconnectNode, removeNode, renameNode } from '../../../infra/node/fleetActions'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import NodeChip from '../../fleet/NodeChip'
import NodePairingCode from './NodePairingCode'
import '../../fleet/nodes.css'
import { Alert, Button, Input } from '../../../kit/components/primitives'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { confirmAction } from '../../../host/registries/shell/willPhase'
import { createSettingSave } from '../settingSave'
import { useUnsavedChanges } from '../unsavedChanges'

// Settings → Nodes (docs/ui-design.md § Node management): add, rename, reconnect, unpair, revoke.
//
// One component with three inline steps rather than a wizard framework. Step 2 exists because comparing
// the fingerprint against the one the node itself displays is the security of pairing
// (docs/api-reference.md § Pairing). Making it a deliberate screen with the value in front of the owner,
// rather than a checkbox next to a URL field, is the point: a checkbox is a thing people tick.
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
  const nodeIds = () => nodes().map((node) => node.nodeId)
  const [renameValue, setRenameValue] = createSignal('')
  // The rename's save state lives here and not in the row, because every fleet refresh hands back new
  // records and `For` rebuilds each row, the renamed one included, so a row-held Saved would vanish the
  // moment the write it reports lands. `renamed` says which row the state belongs to.
  const renameSave = createSettingSave()
  const [renamed, setRenamed] = createSignal<string | null>(null)
  // Who each node is attached to, if anyone (docs/node-enrollment.md). Fanned out, so the row for a
  // node that cannot answer simply has no attachment line.
  const [attachments, { refetch: refetchAttachments }] = createAttachments()

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

  // Pairing is a form: an address, then a code and two names, none of which means anything alone. Once
  // someone has typed an address or a code, leaving settings asks first.
  useUnsavedChanges(() => step().kind !== 'idle' && (endpoint().trim() !== 'https://' || !!code().trim()))

  // Blur or Enter saves, the same as every text setting. An empty name or the same name writes nothing
  // and just closes the field. A failed write keeps the field open with what was typed.
  const commitRename = async (node: NodeRecord, value: string) => {
    // Escape closed the field already, and the blur that follows must not save what it dropped.
    if (renaming() !== node.nodeId) return
    const next = value.trim()
    if (!next || next === node.label) {
      setRenaming(null)
      return
    }
    setRenamed(node.nodeId)
    // Only this row's field: a slow save must not close a rename someone has since opened on another.
    if (await renameSave.run(() => renameNode(node.nodeId, next)) && renaming() === node.nodeId) setRenaming(null)
  }

  // Unpair and revoke each name what goes and what stays, because the two are easy to confuse and only
  // one of them can be undone with the same pairing (docs/ui-design.md § Node management).
  const unpair = async (node: NodeRecord) => {
    const confirmed = await confirmAction({
      title: `Unpair ${node.label}?`,
      actionLabel: 'Unpair',
      goes: 'This client forgets the node and what it cached from it.',
      stays: 'The node keeps this device paired, and everything on the node stays where it is.',
    })
    if (confirmed) await run(() => removeNode(node.nodeId, false))
  }

  const revoke = async (node: NodeRecord) => {
    const confirmed = await confirmAction({
      title: `Revoke this client on ${node.label}?`,
      actionLabel: 'Revoke',
      goes: 'The node deletes this client\'s credential, and this client forgets the node. Coming back takes a new pairing code.',
      stays: 'Everything on the node stays where it is, and its other paired clients keep their access.',
      danger: true,
    })
    if (confirmed) await run(() => removeNode(node.nodeId, true))
  }

  return (
    <div class="nodes-settings">
      <Show
        when={fleetMutable()}
        fallback={
          // `dev:node` in a browser: the serving origin is the node, there's no broker to hold a pinned
          // certificate, and so there's no fleet to manage.
          <p class="muted">This build talks to a single node directly and has no fleet to manage.</p>
        }
      >
        {/* One row per node. The rows are the fleet itself, so this section declares no row labels for
            search. */}
        <SettingsSection id="paired" label="Paired nodes">
          <For each={nodeIds()}>
            {(id) => {
              // By id, so a fleet refresh that hands back new records keeps each row, and a pairing code
              // or a rename open in it, rather than drawing every row again.
              let last = nodes().find((candidate) => candidate.nodeId === id)!
              const node = () => (last = nodes().find((candidate) => candidate.nodeId === id) ?? last)
              const status = () => nodeStatus(node().nodeId)
              const mismatch = () => status()?.error?.code === 'identity_mismatch'
              const mine = () => renamed() === node().nodeId
              // A plain box around the kit row, because a row takes no class: it carries the red border
              // an identity mismatch draws, and the rows' dividers (../../fleet/nodes.css).
              return (
                <div class="node-row" classList={{ 'node-row-alarm': mismatch() }}>
                  <SettingRow
                    label={node().label}
                    layout="stacked"
                    savedAt={mine() ? renameSave.savedAt() : undefined}
                    error={mine() && renaming() === node().nodeId ? renameSave.error() : undefined}
                  >
                    <div class="node-meta">
                      {/* The address in monospace, the way it is typed, rather than as the row's prose. */}
                      <span class="node-sub">{node().endpoint}</span>
                      <Show when={node().local}><span class="node-badge">This computer</span></Show>
                      {/* Provenance: this row was adopted through a plugin's node provider rather
                          than paired by hand, so it is a row that goes away if that plugin does. */}
                      <Show when={node().provider}>
                        {(provider) => <span class="node-badge">via {provider().providerId}</span>}
                      </Show>
                      <NodeChip nodeId={node().nodeId} query={{}} />
                    </div>

                    <Show when={renaming() === node().nodeId}>
                      <Input
                        label="Node name"
                        width="narrow"
                        value={renameValue()}
                        ref={(el) => queueMicrotask(() => el.focus())}
                        onInput={setRenameValue}
                        onChange={(value) => void commitRename(node(), value)}
                        // Handled here, so the Escape that ends a rename does not also close settings.
                        onKeyDown={(event) => {
                          if (event.key !== 'Escape') return
                          event.preventDefault()
                          setRenaming(null)
                        }}
                      />
                    </Show>

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
                            <span class="node-fingerprint-words">{fingerprintPhrase(node().fingerprint) ?? 'unknown'}</span>
                            <span class="node-fingerprint-hex">{node().fingerprint ?? 'unknown'}</span>
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

                    {/* The attachment record: what a control plane left behind, and the button that
                        takes it back (docs/node-enrollment.md § Detaching). Absent on every node nobody
                        provisioned, which is the default and almost always the answer. */}
                    <Show when={attachmentOf(attachments(), node().nodeId)?.attachment}>
                      {(record) => (
                        <div class="node-attachment">
                          <span>
                            Attached to <strong>{record().controlPlaneName ?? new URL(record().controlPlaneUrl).host}</strong>
                            {' '}since {new Date(record().attachedAt).toLocaleDateString()}
                          </span>
                          {/* Says the quiet part out loud, where the owner is deciding: whoever runs that
                              control plane holds a credential for this node until this button is used. */}
                          <p class="muted">
                            That control plane holds a device credential for this node. Detaching revokes it. The node keeps
                            working exactly as it does now.
                          </p>
                          <Button
                            disabled={busy()}
                            onPress={async () => {
                              const plane = record().controlPlaneName ?? new URL(record().controlPlaneUrl).host
                              const confirmed = await confirmAction({
                                title: `Detach ${node().label} from ${plane}?`,
                                actionLabel: 'Detach',
                                goes: `The device credential ${plane} holds for this node is revoked, so it can no longer reach it.`,
                                stays: 'The node keeps working exactly as it does now.',
                                danger: true,
                              })
                              if (confirmed) {
                                void run(async () => {
                                  await detachNode(node().nodeId)
                                  await refetchAttachments()
                                })
                              }
                            }}
                          >
                            Detach…
                          </Button>
                        </div>
                      )}
                    </Show>

                    {/* A provisioned node that could not reach its control plane boots normally, so
                        without this line it looks like an ordinary node that simply never enrolled. */}
                    <Show when={attachmentOf(attachments(), node().nodeId)?.error}>
                      {(failure) => (
                        <Alert tone="warn">
                          This node could not enroll with its control plane on {new Date(failure().at).toLocaleString()}: {failure().reason}
                        </Alert>
                      )}
                    </Show>

                    {/* Unpair and revoke stay on the row rather than in a danger zone: this page is the
                        whole fleet, and each node's own actions belong beside its name. */}
                    <div class="node-actions">
                      <Button disabled={busy()} onPress={() => reconnectNode(node().nodeId)}>Reconnect</Button>
                      <Button
                        disabled={busy()}
                        onPress={() => { setRenameValue(node().label); setRenaming(node().nodeId) }}
                      >
                        Rename
                      </Button>
                      {/* Labelled distinctly on purpose (docs/ui-design.md § Node management). Confusing the two is
                          how an owner loses access to a remote node: unpair is recoverable with the same
                          pairing code, revoke means the node has torn up this client's credential. */}
                      <Show when={!node().local}>
                        <Button
                          disabled={busy()}
                          title="This client forgets the node. The node keeps this device paired."
                          onPress={() => void unpair(node())}
                        >
                          Unpair…
                        </Button>
                        <Button
                          disabled={busy()}
                          title="The node forgets this client. You will need a new pairing code to come back."
                          onPress={() => void revoke(node())}
                        >
                          Revoke this client…
                        </Button>
                      </Show>
                    </div>
                    <NodePairingCode node={node()} />
                  </SettingRow>
                </div>
              )
            }}
          </For>
        </SettingsSection>

        <SettingsSection id="add" label="Add a node">
          <Switch>
            <Match when={step().kind === 'idle'}>
              <Button onPress={() => setStep({ kind: 'endpoint' })}>
                <span class="integration-add-icon">+</span> Add a node
              </Button>
            </Match>

            <Match when={step().kind === 'endpoint'}>
              <div class="node-step">
                <SettingRow
                  label="Node address"
                  description="The address the node prints when it starts. https only — the certificate is the identity."
                  layout="stacked"
                >
                  <Input
                    label="Node address"
                    assist={false}
                    value={endpoint()}
                    placeholder="https://host:port"
                    ref={(el) => queueMicrotask(() => el.focus())}
                    onInput={setEndpoint}
                    onSubmit={() => void probe()}
                  />
                </SettingRow>
                <div class="node-step-actions">
                  <Button disabled={busy()} onPress={() => void probe()}>{busy() ? 'Contacting…' : 'Continue'}</Button>
                  <Button onPress={cancel}>Cancel</Button>
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
                      <Button
                        disabled={!probed().compatible}
                        onPress={() => setStep({ kind: 'code', probe: probed() })}
                      >
                        It matches
                      </Button>
                      <Button onPress={cancel}>It does not — stop</Button>
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
                    <SettingRow
                      label="Pairing code"
                      description="Start pairing on the node to get a code. It expires shortly and allows a few attempts."
                      layout="stacked"
                    >
                      <Input
                        label="Pairing code"
                        assist={false}
                        value={code()}
                        ref={(el) => queueMicrotask(() => el.focus())}
                        onInput={setCode}
                        onSubmit={() => void pair(probed())}
                      />
                    </SettingRow>
                    <SettingRow label="This device's name" layout="stacked">
                      <Input label="This device's name" value={deviceName()} onInput={setDeviceName} />
                    </SettingRow>
                    <SettingRow label="Name for this node" layout="stacked">
                      <Input label="Name for this node" value={label()} onInput={setLabel} />
                    </SettingRow>
                    <div class="node-step-actions">
                      <Button disabled={busy() || !code().trim()} onPress={() => void pair(probed())}>
                        {busy() ? 'Pairing…' : 'Pair'}
                      </Button>
                      <Button onPress={cancel}>Cancel</Button>
                    </div>
                  </div>
                )
              }}
            </Match>
          </Switch>
        </SettingsSection>

        {/* Outside both sections, because a failed detach, unpair or revoke above lands here as well
            as a failed pairing. */}
        <Show when={error()}><Alert>{error()}</Alert></Show>

        {/* The fleet's other half (./ProvidedNodes.tsx). Draws nothing at all unless some node reports
            a node provider. */}
        <ProvidedNodes />
      </Show>
    </div>
  )
}
