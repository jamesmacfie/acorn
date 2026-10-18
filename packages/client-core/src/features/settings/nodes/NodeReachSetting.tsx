import { createResource, createSignal, For, Show } from 'solid-js'
import { readNodeReach, restartLocalNode, writeNodeReach } from '../../../infra/node/fleetActions'
import { Alert, Button, Checkbox, Field, Input } from '../../../kit/components/primitives'
import CopyButton from '../../../kit/components/inputs/CopyButton'
import { Text } from '../../../kit/components/content/Text'
import { Inline } from '../../../kit/components/layout/Inline'
import { Stack } from '../../../kit/components/layout/Stack'

// The local Node's row: whether other machines can reach it, and the address to give them
// (docs/node-distribution/reaching.md). Remote rows don't draw this, because a Node takes this change
// only from its own computer.
//
// Saving restarts the Node, and a restart reloads this window, so everything shown comes from the
// Node's answer and nothing from what this component remembers.
export function NodeReachSetting(props: { nodeId: string }) {
  const [reach, { refetch }] = createResource(() => props.nodeId, readNodeReach)
  const [choosing, setChoosing] = createSignal(false)
  const [chosen, setChosen] = createSignal<string[]>([])
  const [name, setName] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const hosts = () => [...chosen(), ...(name().trim() ? [name().trim()] : [])]
  const endpoints = () => reach()?.hosts.map((host) => `https://${host}:${reach()!.port}`) ?? []

  // Records the hosts, when given, then restarts the Node so its listener binds them. Resolves false
  // on a failure, which puts the switch back.
  const apply = async (next?: string[]): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      if (next) await writeNodeReach(props.nodeId, next)
      await restartLocalNode()
      setChoosing(false)
      await refetch()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      await refetch()
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={reach()}>
      {(current) => (
        <Stack gap="row">
          <Checkbox
            switch
            label="Reachable from other machines"
            hint="Other computers on this network can pair with this node and run terminals and agents on it. Turn this on only on a network you trust."
            checked={current().hosts.length > 0 || choosing()}
            disabled={busy() || current().source === 'environment'}
            onChange={(on) => {
              if (!on && choosing()) return setChoosing(false)
              if (!on) return apply([])
              setChosen([])
              setName('')
              setChoosing(true)
            }}
          />
          <Show when={current().source === 'environment'}>
            <Text emphasis="muted" wrap>
              ACORN_ADVERTISE_HOST sets this node's addresses. Change the variable to change them.
            </Text>
          </Show>

          <Show when={choosing()}>
            <Stack gap="row">
              <Text wrap>Which address should other computers use?</Text>
              <For each={current().candidates}>
                {(candidate) => (
                  <Checkbox
                    label={`${candidate.address} (${candidate.interface})`}
                    checked={chosen().includes(candidate.address)}
                    onChange={(on) =>
                      setChosen((list) =>
                        on ? [...list, candidate.address] : list.filter((address) => address !== candidate.address),
                      )
                    }
                  />
                )}
              </For>
              <Field
                label="Host name"
                hint="A name for this computer, such as a .local or Tailscale name. Other computers must connect with exactly this name. An address can change, and a name usually doesn't."
              >
                <Input label="Host name" assist={false} value={name()} placeholder="workshop.local" onInput={setName} />
              </Field>
              <Inline gap="row">
                <Button
                  variant="solid"
                  tone="accent"
                  disabled={busy() || hosts().length === 0}
                  onPress={() => void apply(hosts())}
                >
                  {busy() ? 'Restarting…' : 'Save and restart'}
                </Button>
                <Button variant="ghost" disabled={busy()} onPress={() => setChoosing(false)}>
                  Cancel
                </Button>
              </Inline>
            </Stack>
          </Show>

          <Show when={!choosing() && !current().restartRequired && endpoints().length > 0}>
            <Stack gap="inline">
              <Text wrap>On the other computer, add a node with this address, then choose Pair another client:</Text>
              <For each={endpoints()}>
                {(endpoint) => (
                  <div class="copyable">
                    <code>{endpoint}</code>
                    <CopyButton text={() => endpoint} title="Copy the address" always />
                  </div>
                )}
              </For>
            </Stack>
          </Show>

          <Show when={current().restartRequired}>
            <Alert
              tone="warn"
              variant="banner"
              actions={
                <Button size="sm" disabled={busy()} onPress={() => void apply()}>
                  Restart node
                </Button>
              }
            >
              This node still answers on its earlier addresses until it restarts.
            </Alert>
          </Show>
          <Show when={error()}>
            <Alert>{error()}</Alert>
          </Show>
        </Stack>
      )}
    </Show>
  )
}
