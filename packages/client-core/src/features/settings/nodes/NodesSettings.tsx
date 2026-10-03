import { createSignal, For, Match, Show, Switch, type JSX } from 'solid-js'
import type { NodeProbeResult, NodeRecord } from '@acorn/protocol/broker.ts'
import { nodes, nodeStatus } from '../../../infra/node/fleet'
import { attachmentOf, createAttachments, detachNode } from '../../../infra/node/attachment'
import ProvidedNodes from './ProvidedNodes'
import { fleetMutable, pairNode, probeNodeEndpoint, reconnectNode, removeNode, renameNode } from '../../../infra/node/fleetActions'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import NodeChip from '../../fleet/NodeChip'
import { createNodePairing, NodePairingButton, NodePairingPanel } from './NodePairingCode'
import '../../fleet/nodes.css'
import { Alert, Badge, Button, Card, EmptyState, Field, Input } from '../../../kit/components/primitives'
import Icon from '../../../kit/components/content/Icon'
import { Text } from '../../../kit/components/content/Text'
import { Inline } from '../../../kit/components/layout/Inline'
import { Stack } from '../../../kit/components/layout/Stack'
import { pluginLabel } from '../../../host/plugins/pluginLabel'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { confirmAction } from '../../../host/registries/shell/willPhase'
import { createSettingSave } from '../settingSave'
import { useUnsavedChanges } from '../unsavedChanges'

// Settings → Nodes (docs/frontend/settings-groups.md § Node management): add, rename, reconnect, unpair, revoke.
//
// One component with three inline steps rather than a wizard framework. Step 2 exists because comparing
// the fingerprint against the one the node itself displays is the security of pairing
// (docs/api-reference/transport.md § Pairing). Making it a deliberate screen with the value in front of the owner,
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

  // Blur or Enter saves, the same as every text setting, and either one closes the field, typed in or
  // not. An empty name or the same name writes nothing. A failed write keeps the field open with what
  // was typed. Enter and then a blur both arrive for one rename, so the second waits on the first
  // rather than writing again.
  let renameInFlight = false
  const commitRename = async (node: NodeRecord, value: string) => {
    // Escape closed the field already, and the blur that follows must not save what it dropped.
    if (renaming() !== node.nodeId || renameInFlight) return
    const next = value.trim()
    if (!next || next === node.label) {
      setRenaming(null)
      return
    }
    setRenamed(node.nodeId)
    renameInFlight = true
    try {
      // Only this row's field: a slow save must not close a rename someone has since opened on another.
      if (await renameSave.run(() => renameNode(node.nodeId, next)) && renaming() === node.nodeId) setRenaming(null)
    } finally {
      renameInFlight = false
    }
  }

  // Unpair and revoke each name what goes and what stays, because the two are easy to confuse and only
  // one of them can be undone with the same pairing (docs/frontend/settings-groups.md § Node management).
  const unpair = async (node: NodeRecord) => {
    const confirmed = await confirmAction({
      title: `Unpair ${node.label}`,
      actionLabel: 'Unpair',
      goes: 'This client forgets the node and what it cached from it.',
      stays: 'The node keeps this device paired, and everything on the node stays where it is.',
    })
    if (confirmed) await run(() => removeNode(node.nodeId, false))
  }

  const revoke = async (node: NodeRecord) => {
    const confirmed = await confirmAction({
      title: `Revoke this client on ${node.label}`,
      actionLabel: 'Revoke',
      goes: 'The node deletes this client\'s credential, and this client forgets the node. Coming back takes a new pairing code.',
      stays: 'Everything on the node stays where it is, and its other paired clients keep their access.',
      danger: true,
    })
    if (confirmed) await run(() => removeNode(node.nodeId, true))
  }

  // A step of the pairing form, in the one shape for a boxed form on a settings page: a card that says
  // where it is in the three, its fields, then its primary action and Cancel under the last one
  // (docs/frontend/settings-pages.md § Forms and flows).
  const pairingStep = (props: { step: number; children: JSX.Element; actions: JSX.Element }) => (
    <Card>
      <Stack gap="row">
        <Text emphasis="muted">Step {props.step} of 3</Text>
        {props.children}
        <Inline gap="row">{props.actions}</Inline>
      </Stack>
    </Card>
  )

  return (
    <div class="nodes-settings">
      <Show
        when={fleetMutable()}
        fallback={
          // `dev:node` in a browser: the serving origin is the node, there's no broker to hold a pinned
          // certificate, and so there's no fleet to manage.
          <EmptyState align="start" size="sm">This window connects to one node directly, so there are no other nodes to add or remove.</EmptyState>
        }
      >
        {/* One row per node. The rows are the fleet itself, so this section declares no row labels for
            search. Adding a node is this section's action, and its form opens under the list. */}
        <SettingsSection
          id="paired"
          label="Paired nodes"
          actions={
            <Show when={step().kind === 'idle'}>
              <Button size="sm" onPress={() => setStep({ kind: 'endpoint' })}>
                <Icon name="plus" /> Add a node
              </Button>
            </Show>
          }
        >
          <For each={nodeIds()}>
            {(id) => {
              // By id, so a fleet refresh that hands back new records keeps each row, and a pairing code
              // or a rename open in it, rather than drawing every row again.
              let last = nodes().find((candidate) => candidate.nodeId === id)!
              const node = () => (last = nodes().find((candidate) => candidate.nodeId === id) ?? last)
              const status = () => nodeStatus(node().nodeId)
              const mismatch = () => status()?.error?.code === 'identity_mismatch'
              const mine = () => renamed() === node().nodeId
              const pairing = createNodePairing(() => node().nodeId)
              // A plain box around the kit row, because a row takes no class: it carries the red border
              // an identity mismatch draws, and the rows' dividers (../../fleet/nodes.css).
              return (
                <div class="node-row" classList={{ 'node-row-alarm': mismatch() }}>
                  <SettingRow
                    label={node().label}
                    description={node().endpoint}
                    layout="stacked"
                    savedAt={mine() ? renameSave.savedAt() : undefined}
                    error={mine() && renaming() === node().nodeId ? renameSave.error() : undefined}
                  >
                    <Inline gap="row" wrap>
                      <NodeChip nodeId={node().nodeId} query={{}} />
                      {/* Only when the name is something else, or the row would say it twice. */}
                      <Show when={node().local && node().label !== 'This computer'}><Badge size="xs">This computer</Badge></Show>
                      {/* Provenance: this row was adopted through a plugin's node provider rather
                          than paired by hand, so it is a row that goes away if that plugin does. */}
                      <Show when={node().provider}>
                        {/* The id is `<pluginId>:<providerId>`, so the plugin names it. */}
                        {(provider) => <Badge size="xs">From {pluginLabel(provider().providerId.split(':')[0]!)}</Badge>}
                      </Show>
                    </Inline>

                    <Show when={renaming() === node().nodeId}>
                      <Input
                        label="Node name"
                        value={renameValue()}
                        ref={(el) => queueMicrotask(() => el.focus())}
                        onInput={setRenameValue}
                        onSubmit={(value) => void commitRename(node(), value)}
                        onBlur={() => void commitRename(node(), renameValue())}
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
                        <Text emphasis="strong" wrap>This node's identity changed.</Text>
                        <Text emphasis="muted" wrap>
                          acorn has stopped connecting to it. If you rebuilt this node, unpair it and pair again, and
                          check the words it shows. If you didn't, someone may be intercepting the connection.
                        </Text>
                        <dl class="node-fingerprints">
                          <dt>Expected</dt>
                          <dd>
                            <span class="node-fingerprint-words">{fingerprintPhrase(node().fingerprint) ?? 'unknown'}</span>
                            <span class="node-fingerprint-hex">{node().fingerprint ?? 'unknown'}</span>
                          </dd>
                          <Show when={status()?.error?.presentedFingerprint}>
                            {(presented) => (
                              <>
                                <dt>Received</dt>
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
                      {(record) => {
                        const plane = () => record().controlPlaneName ?? new URL(record().controlPlaneUrl).host
                        return (
                          <Card>
                            <Stack gap="row">
                              <Text wrap>
                                Attached to {plane()} since {new Date(record().attachedAt).toLocaleDateString()}
                              </Text>
                              {/* Says the quiet part out loud, where the owner is deciding: whoever runs
                                  that control plane holds a credential for this node until this button
                                  is used. */}
                              <Text emphasis="muted" wrap>{plane()} can reach this node until you detach it. Detaching changes nothing else.</Text>
                              <Button
                                size="sm"
                                tone="danger"
                                disabled={busy()}
                                onPress={async () => {
                                  const confirmed = await confirmAction({
                                    title: `Detach ${node().label} from ${plane()}`,
                                    actionLabel: 'Detach',
                                    goes: `The device credential ${plane()} holds for this node is revoked, so it can no longer reach it.`,
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
                            </Stack>
                          </Card>
                        )
                      }}
                    </Show>

                    {/* A provisioned node that could not reach its control plane boots normally, so
                        without this line it looks like an ordinary node that simply never enrolled. */}
                    <Show when={attachmentOf(attachments(), node().nodeId)?.error}>
                      {(failure) => (
                        <Alert tone="warn">
                          This node couldn't connect to its control plane on {new Date(failure().at).toLocaleString()}: {failure().reason}
                        </Alert>
                      )}
                    </Show>

                    {/* Unpair and revoke stay on the row rather than in a danger zone: this page is the
                        whole fleet, and each node's own actions belong beside its name. */}
                    <Inline gap="row" wrap>
                      <Button size="sm" disabled={busy()} onPress={() => reconnectNode(node().nodeId)}>Reconnect</Button>
                      <Button
                        size="sm"
                        disabled={busy()}
                        onPress={() => { setRenameValue(node().label); setRenaming(node().nodeId) }}
                      >
                        Rename
                      </Button>
                      <NodePairingButton pairing={pairing} />
                      {/* Labelled distinctly on purpose (docs/frontend/settings-groups.md § Node management). Confusing the two is
                          how an owner loses access to a remote node: unpair is recoverable with the same
                          pairing code, revoke means the node has torn up this client's credential. */}
                      <Show when={!node().local}>
                        <Button
                          size="sm"
                          tone="danger"
                          disabled={busy()}
                          title="This client forgets the node. The node keeps this device paired."
                          onPress={() => void unpair(node())}
                        >
                          Unpair…
                        </Button>
                        <Button
                          size="sm"
                          tone="danger"
                          disabled={busy()}
                          title="The node forgets this computer. To connect again, you need a new pairing code."
                          onPress={() => void revoke(node())}
                        >
                          Revoke this client…
                        </Button>
                      </Show>
                    </Inline>
                    <NodePairingPanel node={node()} pairing={pairing} />
                  </SettingRow>
                </div>
              )
            }}
          </For>

          <Switch>
            <Match when={step().kind === 'endpoint'}>
              {pairingStep({
                step: 1,
                children: (
                  <Field label="Node address" hint="The https address the node shows when it starts.">
                    <Input
                      label="Node address"
                      assist={false}
                      value={endpoint()}
                      placeholder="https://host:port"
                      ref={(el) => queueMicrotask(() => el.focus())}
                      onInput={setEndpoint}
                      onSubmit={() => void probe()}
                    />
                  </Field>
                ),
                actions: (
                  <>
                    <Button variant="solid" tone="accent" disabled={busy()} onPress={() => void probe()}>{busy() ? 'Contacting…' : 'Continue'}</Button>
                    <Button variant="ghost" onPress={cancel}>Cancel</Button>
                  </>
                ),
              })}
            </Match>

            <Match when={step().kind === 'confirm' && step()}>
              {(current) => {
                const probed = () => (current() as Extract<Step, { kind: 'confirm' }>).probe
                return pairingStep({
                  step: 2,
                  children: (
                    <>
                      <Text emphasis="strong" wrap>Does the node show these words?</Text>
                      <Text emphasis="muted" wrap>
                        Check them against what {probed().endpoint} shows. This is how you know you're pairing with your
                        own node, and acorn can't check it for you.
                      </Text>
                      {/* Words first, hex second. Two 64-character hex strings differing in the middle look
                          identical to a person, which is exactly the substitution an attacker wants — so the
                          phrase is what the owner is asked to compare, and the hex stays for anyone who would
                          rather paste and diff it exactly (@acorn/protocol/fingerprintWords.ts). */}
                      <Show when={fingerprintPhrase(probed().fingerprint)}>
                        {(phrase) => <div class="node-fingerprint node-fingerprint-words">{phrase()}</div>}
                      </Show>
                      <div class="node-fingerprint node-fingerprint-hex">{probed().fingerprint}</div>
                      <Show when={!probed().compatible}>
                        <Alert>
                          This node and this app can't talk to each other (versions {probed().protocolVersion} and{' '}
                          {NODE_PROTOCOL_VERSION}). Update the older one, then pair.
                        </Alert>
                      </Show>
                    </>
                  ),
                  actions: (
                    <>
                      <Button
                        variant="solid"
                        tone="accent"
                        disabled={!probed().compatible}
                        onPress={() => setStep({ kind: 'code', probe: probed() })}
                      >
                        They match
                      </Button>
                      <Button variant="ghost" onPress={cancel}>They don't match</Button>
                    </>
                  ),
                })
              }}
            </Match>

            <Match when={step().kind === 'code' && step()}>
              {(current) => {
                const probed = () => (current() as Extract<Step, { kind: 'code' }>).probe
                return pairingStep({
                  step: 3,
                  children: (
                    <>
                      <Field label="Pairing code" hint="On the node, choose Pair another client to get a code. It works for a few minutes.">
                        <Input
                          label="Pairing code"
                          assist={false}
                          value={code()}
                          ref={(el) => queueMicrotask(() => el.focus())}
                          onInput={setCode}
                          onSubmit={() => void pair(probed())}
                        />
                      </Field>
                      <Field label="Name for this computer">
                        <Input label="Name for this computer" value={deviceName()} onInput={setDeviceName} />
                      </Field>
                      <Field label="Name for this node">
                        <Input label="Name for this node" value={label()} onInput={setLabel} />
                      </Field>
                    </>
                  ),
                  actions: (
                    <>
                      <Button variant="solid" tone="accent" disabled={busy() || !code().trim()} onPress={() => void pair(probed())}>
                        {busy() ? 'Pairing…' : 'Pair'}
                      </Button>
                      <Button variant="ghost" onPress={cancel}>Cancel</Button>
                    </>
                  ),
                })
              }}
            </Match>
          </Switch>
        </SettingsSection>

        {/* Outside the section's rows, because a failed detach, unpair or revoke above lands here as
            well as a failed pairing. */}
        <Show when={error()}><Alert>{error()}</Alert></Show>

        {/* The fleet's other half (./ProvidedNodes.tsx). Draws nothing at all unless some node reports
            a node provider. */}
        <ProvidedNodes />
      </Show>
    </div>
  )
}
