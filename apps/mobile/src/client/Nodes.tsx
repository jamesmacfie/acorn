import { createResource, createSignal, For, Show } from 'solid-js'
import { removeNode } from '@acorn/client-core/infra/node/fleetActions.ts'
import { dropNode } from '@acorn/client-core/infra/node/fleet.ts'
import { Alert, Button, ConfirmButton, EmptyState, Row } from '@acorn/client-core/kit/components/primitives.tsx'
import { Text } from '@acorn/client-core/kit/components/content'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import type { AccountNode } from '@acorn/protocol/account.ts'
import { AccountError, listAccountNodes } from './account'
import { pairedNodes } from './pairedNodes'
import { pairWithNode, type Pairing } from './pairing'
import { pairedVersion, setSignedOut } from './platform'

/** The account's Nodes, and which of them this phone is paired with. Pairing runs here: the phone asks, and
 *  a device that is already paired shows the same three words and an Allow button. */
export function Nodes(props: { onOpen(nodeId: string): void; onBack?: () => void }) {
  const [listed, { refetch }] = createResource(async () => {
    try {
      return await listAccountNodes()
    } catch (error) {
      if (error instanceof AccountError && error.signedOut) setSignedOut(true)
      throw error
    }
  })
  const [paired] = createResource(pairedVersion, async () => new Set((await pairedNodes()).map((node) => node.nodeId)))
  const [pairing, setPairing] = createSignal<{ nodeId: string; phrase?: string } | null>(null)
  const [error, setError] = createSignal('')
  let current: Pairing | undefined

  const connect = async (node: AccountNode) => {
    setError('')
    setPairing({ nodeId: node.nodeId })
    try {
      current = await pairWithNode(node)
      setPairing({ nodeId: node.nodeId, phrase: current.phrase })
      await current.paired
      setPairing(null)
      props.onOpen(node.nodeId)
    } catch (failure) {
      setPairing(null)
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  const cancel = () => current?.cancel()
  // This phone's own record only. The device stays on the Node's list until someone revokes it there.
  const forget = async (nodeId: string) => {
    await removeNode(nodeId, false)
    await dropNode(nodeId)
  }

  return (
    <>
      {/* Not the screens' TopBar, which needs a router and a Node, and the first screen has neither. */}
      <header class="mobile-bar mobile-top">
        <Show when={props.onBack}>{(back) => <IconButton icon="arrow-left" label="Back" onPress={back()} />}</Show>
        <div class="mobile-title">
          <Text emphasis="strong">Nodes</Text>
        </div>
      </header>
      <main class="mobile-body">
        <Show when={error()}>
          <Alert>{error()}</Alert>
        </Show>
        <Show
          when={!listed.error}
          fallback={
            <EmptyState
              title="Can’t read your account’s Nodes"
              action={<Button onPress={() => void refetch()}>Try again</Button>}
            >
              {listed.error instanceof AccountError ? listed.error.message : 'Something went wrong.'}
            </EmptyState>
          }
        >
          <Show when={listed()} fallback={<EmptyState busy title="Loading your Nodes" />}>
            {(nodes) => (
              <For
                each={nodes()}
                fallback={
                  <EmptyState title="No Nodes yet">
                    In Acorn on your computer, open Settings, then Account, and turn on Remote access.
                  </EmptyState>
                }
              >
                {(node) => {
                  const isPaired = () => paired()?.has(node.nodeId) ?? false
                  const mine = () => pairing()?.nodeId === node.nodeId
                  return (
                    <Row
                      variant="stacked"
                      onPress={isPaired() ? () => props.onOpen(node.nodeId) : undefined}
                      trailing={
                        <Show
                          when={isPaired()}
                          fallback={
                            <Button
                              variant="solid"
                              busy={mine()}
                              disabled={!!pairing() || !node.channelKey}
                              onPress={() => void connect(node)}
                            >
                              Connect
                            </Button>
                          }
                        >
                          <>
                            <ConfirmButton
                              variant="ghost"
                              confirmLabel="Forget Node?"
                              onConfirm={() => void forget(node.nodeId)}
                            >
                              Forget
                            </ConfirmButton>
                            <Button onPress={() => props.onOpen(node.nodeId)}>Open</Button>
                          </>
                        </Show>
                      }
                    >
                      <Text emphasis="strong">{node.label}</Text>
                      <Show
                        when={mine() && pairing()?.phrase}
                        fallback={
                          <Text emphasis="muted">
                            {isPaired()
                              ? 'Paired'
                              : node.channelKey
                                ? 'Not paired'
                                : 'Needs Remote access turned off and on'}
                          </Text>
                        }
                      >
                        {(phrase) => (
                          <>
                            <Text emphasis="muted" wrap>
                              Allow this phone on a device that is already paired. It should show:
                            </Text>
                            <Text emphasis="strong">{phrase()}</Text>
                            <Button variant="ghost" onPress={cancel}>
                              Cancel
                            </Button>
                          </>
                        )}
                      </Show>
                    </Row>
                  )
                }}
              </For>
            )}
          </Show>
        </Show>
      </main>
    </>
  )
}
