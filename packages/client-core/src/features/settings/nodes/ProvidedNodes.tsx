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
import { Alert, Badge, Button, Card, Field, Input } from '../../../kit/components/primitives'
import Icon from '../../../kit/components/content/Icon'
import { Inline } from '../../../kit/components/layout/Inline'
import { Stack } from '../../../kit/components/layout/Stack'
import { pluginLabel } from '../../../host/plugins/pluginLabel'
import { confirmAction } from '../../../host/registries/shell/willPhase'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { useUnsavedChanges } from '../unsavedChanges'
import '../../fleet/nodes.css'

// Settings → Nodes, second half: the nodes a plugin's node provider knows about, and the four
// lifecycle verbs (docs/plugins/node-providers.md § Node providers).
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

  // Naming a new node is a form with Create and Cancel, so a typed name counts as unsaved.
  useUnsavedChanges(() => creating() !== null && !!newLabel().trim())

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

  // A provider's own name, or its plugin's when no node listed the provider: its id is
  // `<pluginId>:<providerId>`.
  const providerName = (id: string): string =>
    provided().rows.flatMap((answer) => answer.data.providers).find((provider) => provider.id === id)?.label
      ?? pluginLabel(id.split(':')[0]!)

  return (
    <Show when={hasNodeProviders(provided())}>
      <SettingsSection
        id="provided"
        label="Nodes from a provider"
        help="Machines a plugin, such as a cloud provider, can run for you. Add one to use it here. acorn checks its identity when it connects."
      >
        {/* A provider that could not answer is a line, never a failed page: the rest of the list is
            still true (docs/architecture/fleet.md § Client state and fleet behavior). */}
        <For each={providerFailures(provided())}>
          {(failure) => <Alert tone="warn" variant="banner">{providerName(failure.providerId)} couldn't list its machines: {failure.reason}</Alert>}
        </For>

        <For each={rows()}>
          {(row: ProvidedNodeRow) => (
            <SettingRow label={row.label} description={row.endpoint ?? row.providerNodeId}>
              <Inline gap="row" wrap>
                <Badge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Badge>
                <Badge size="xs">From {row.providerLabel}</Badge>
                <Show when={row.adoptedAs}><Badge size="xs">In this fleet</Badge></Show>
                {/* Adoption needs a host that holds device tokens. In a plain browser served by a
                    node there is none, so the row shows without the button rather than offering one
                    that cannot work. */}
                <Show when={!row.adoptedAs && row.state === 'ready' && canPairNodes()}>
                  <Button size="sm" disabled={busy()} onPress={() => void run(async () => { await adoptProvidedNode(row) })}>
                    Add to this computer
                  </Button>
                </Show>
                <For each={OFFERED[row.state].filter((verb) => row.verbs.includes(verb))}>
                  {(verb) => (
                    <Show
                      when={NODE_LIFECYCLE_RISK[verb] === 'execute'}
                      fallback={
                        <Button size="sm" disabled={busy()} onPress={() => void run(() => runNodeLifecycle(verb, row))}>
                          {VERB_LABEL[verb]}
                        </Button>
                      }
                    >
                      {/* The `execute` tier, drawn from NODE_LIFECYCLE_RISK exactly as an armed
                          schedule draws its confirmation from a node action's tier. Destroying a node
                          is the most consequential button in the product, and it is the only one here
                          that asks twice. */}
                      <Button
                        size="sm"
                        tone="danger"
                        disabled={busy()}
                        onPress={async () => {
                          const confirmed = await confirmAction({
                            title: `${VERB_LABEL[verb]} ${row.label}`,
                            actionLabel: VERB_LABEL[verb],
                            goes: `${row.providerLabel} ${VERB_LABEL[verb].toLowerCase()}s ${row.label}, with everything stored on that machine.`,
                            stays: 'Your other nodes, and everything this device keeps, stay as they are.',
                            danger: true,
                          })
                          if (confirmed) void run(() => runNodeLifecycle(verb, row))
                        }}
                      >
                        {VERB_LABEL[verb]}…
                      </Button>
                    </Show>
                  )}
                </For>
              </Inline>
            </SettingRow>
          )}
        </For>

        {/* By id: each read builds new provider objects, and a row drawn again would drop the focus in
            its name field. */}
        <For each={creatableProviders(provided()).map((provider) => provider.id)}>
          {(id) => {
            let last = creatableProviders(provided()).find((provider) => provider.id === id)!
            const target = () => (last = creatableProviders(provided()).find((provider) => provider.id === id) ?? last)
            return (
              <Show
                when={creating() === target().id}
                fallback={
                  <Button onPress={() => { setCreating(target().id); setNewLabel('') }}>
                    <Icon name="plus" /> New node on {target().label}
                  </Button>
                }
              >
                {/* The settings page's one boxed-form shape: a card of fields, then the primary
                    action and Cancel under the last one. */}
                <Card>
                  <Stack gap="row">
                  <Field label="Name for the new node">
                    <Input
                      label="Name for the new node"
                      value={newLabel()}
                      ref={(el) => queueMicrotask(() => el.focus())}
                      onInput={(value) => setNewLabel(value)}
                    />
                  </Field>
                  <Inline gap="row">
                    <Button
                      variant="solid"
                      tone="accent"
                      disabled={busy() || !newLabel().trim()}
                      onPress={() => void run(async () => {
                        await createProvidedNode({ providerId: target().id, sourceNodeId: target().sourceNodeId }, newLabel().trim())
                        setCreating(null)
                      })}
                    >
                      {busy() ? 'Creating…' : 'Create'}
                    </Button>
                    <Button variant="ghost" onPress={() => setCreating(null)}>Cancel</Button>
                  </Inline>
                  </Stack>
                </Card>
              </Show>
            )
          }}
        </For>

        <Show when={error()}><Alert>{error()}</Alert></Show>
      </SettingsSection>
    </Show>
  )
}
