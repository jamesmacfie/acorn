import { createSignal, For, Show } from 'solid-js'
import { NODE_LIFECYCLE_RISK, type NodeLifecycleVerb, type ProvidedNodeState } from '@acorn/protocol/nodeProviders.ts'
import {
  adoptProvidedNode,
  createProvidedNode,
  creatableProviders,
  createProvidedNodes,
  hasNodeProviders,
  mergeProvidedNodes,
  providerFailures,
  runNodeLifecycle,
  type ProvidedNodeRow,
} from '../../../infra/node/providedNodes'
import { nodes } from '../../../infra/node/fleet'
import { canPairNodes } from '../../../infra/platform'
import { Alert, Badge, Button, ConfirmButton, Input } from '../../../kit/components/primitives'
import '../../fleet/nodes.css'

// Settings → Nodes, second half: the nodes a plugin's node provider knows about, and the four
// lifecycle verbs (docs/plugins.md § Node providers).
//
// Beside the paired list rather than on Fleet home, because Fleet home only appears once more than one
// node is paired, and the first cloud node someone adopts is adopted while exactly one node exists.
// This page is always reachable and already owns "add a node", which is what adopting is.
//
// The whole section is hidden when no node reports a provider, so an install with no cloud plugin never
// mentions any of this.

// What each state is called, and what it means for the buttons. `provisioning` is the state this
// vocabulary exists for: a node being built is not offline, and saying so is the difference between
// "wait a moment" and "something is broken".
const STATE_LABEL: Record<ProvidedNodeState, string> = {
  provisioning: 'Building',
  ready: 'Ready',
  stopped: 'Stopped',
  failed: 'Failed',
}

const STATE_TONE: Record<ProvidedNodeState, 'accent' | 'ok' | 'danger' | 'neutral'> = {
  provisioning: 'accent',
  ready: 'ok',
  stopped: 'neutral',
  failed: 'danger',
}

const VERB_LABEL: Record<NodeLifecycleVerb, string> = {
  create: 'Create',
  destroy: 'Destroy',
  start: 'Start',
  stop: 'Stop',
}

// Which verbs are offered for a node in a given state. Not a permission — the provider decides what it
// will accept — but offering Start on a running node is a button whose only outcome is a shrug.
const OFFERED: Record<ProvidedNodeState, readonly ('destroy' | 'start' | 'stop')[]> = {
  // Destroy is offered even while building. A machine stuck in `provisioning` is the case somebody most
  // needs a way out of, and it is the one somebody is being billed for.
  provisioning: ['destroy'],
  ready: ['stop', 'destroy'],
  stopped: ['start', 'destroy'],
  failed: ['destroy'],
}

export default function ProvidedNodes() {
  const [provided, { refetch }] = createProvidedNodes()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [creating, setCreating] = createSignal<string | null>(null)
  const [newLabel, setNewLabel] = createSignal('')

  const rows = () => mergeProvidedNodes(provided(), nodes())
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
      await refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={hasNodeProviders(provided())}>
      <section class="provided-nodes">
        <h3>Nodes from a provider</h3>
        <p class="muted">
          Machines a plugin on one of your nodes knows about. Adopting one adds it to this client's fleet; the plugin
          vouches for its identity, and acorn checks that against the certificate the node presents.
        </p>

        {/* A provider that could not answer is a line, never a failed page: the rest of the list is
            still true (docs/architecture-overview.md § Client state and fleet behavior). */}
        <For each={providerFailures(provided())}>
          {(failure) => <Alert tone="warn" variant="banner">{failure.providerId} could not list its nodes — {failure.reason}</Alert>}
        </For>

        <div class="nodes-list">
          <For each={rows()}>
            {(row: ProvidedNodeRow) => (
              <div class="node-row">
                <div class="node-meta">
                  <span class="node-title">{row.label}</span>
                  <Badge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Badge>
                  <span class="node-badge">via {row.providerLabel}</span>
                  <Show when={row.adoptedAs}><span class="node-badge">In this fleet</span></Show>
                </div>
                <span class="node-sub">{row.endpoint ?? row.providerNodeId}</span>
                <div class="node-actions">
                  {/* Adoption needs a host that holds device tokens. In a plain browser served by a
                      node there is none, so the row shows without the button rather than offering one
                      that cannot work. */}
                  <Show when={!row.adoptedAs && row.state === 'ready' && canPairNodes()}>
                    <Button disabled={busy()} onPress={() => void run(async () => { await adoptProvidedNode(row) })}>
                      Add to this client
                    </Button>
                  </Show>
                  <For each={OFFERED[row.state].filter((verb) => row.verbs.includes(verb))}>
                    {(verb) => (
                      <Show
                        when={NODE_LIFECYCLE_RISK[verb] === 'execute'}
                        fallback={
                          <Button disabled={busy()} onPress={() => void run(() => runNodeLifecycle(verb, row))}>
                            {VERB_LABEL[verb]}
                          </Button>
                        }
                      >
                        {/* The `execute` tier, drawn from NODE_LIFECYCLE_RISK exactly as an armed
                            schedule draws its confirmation from a node action's tier. Destroying a node
                            is the most consequential button in the product, and it is the only one here
                            that asks twice. */}
                        <ConfirmButton
                          disabled={busy()}
                          confirmLabel="Destroy it?"
                          onConfirm={() => void run(() => runNodeLifecycle(verb, row))}
                        >
                          {VERB_LABEL[verb]}…
                        </ConfirmButton>
                      </Show>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>

        <For each={creatableProviders(provided())}>
          {(target) => (
            <Show
              when={creating() === target.id}
              fallback={
                <Button onPress={() => { setCreating(target.id); setNewLabel('') }}>
                  <span class="integration-add-icon">+</span> New node on {target.label}
                </Button>
              }
            >
              <div class="node-step">
                <label class="node-step-label">
                  Name for the new node
                  <Input
                    value={newLabel()}
                    ref={(el) => queueMicrotask(() => el.focus())}
                    onInput={(value) => setNewLabel(value)}
                  />
                </label>
                <div class="node-step-actions">
                  <Button
                    disabled={busy() || !newLabel().trim()}
                    onPress={() => void run(async () => {
                      await createProvidedNode({ providerId: target.id, sourceNodeId: target.sourceNodeId }, newLabel().trim())
                      setCreating(null)
                    })}
                  >
                    {busy() ? 'Creating…' : 'Create'}
                  </Button>
                  <Button onPress={() => setCreating(null)}>Cancel</Button>
                </div>
              </div>
            </Show>
          )}
        </For>

        <Show when={error()}><Alert>{error()}</Alert></Show>
      </section>
    </Show>
  )
}
