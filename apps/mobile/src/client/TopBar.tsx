import { Show, type JSX } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import NodeChip from '@acorn/client-core/features/fleet/NodeChip.tsx'
import { activeNodeId } from '@acorn/client-core/infra/node/activeNode.ts'
import { nodeState } from '@acorn/client-core/infra/node/fleet.ts'
import { narrowBack } from '@acorn/client-core/kit/lib'
import { Text } from '@acorn/client-core/kit/components/content'
import { IconButton } from '@acorn/client-core/kit/components/inputs'

/** The bar at the top of every screen: Back when there is somewhere to go back to, the screen's title
 *  with a line under it, the Node's state whenever it isn't online, and the screen's one action. Back
 *  steps out of a pane's narrow detail first, as a phone app's Back does, and goes to `back` after. */
export function TopBar(props: { title: string; detail?: JSX.Element; back?: string; action?: JSX.Element }) {
  const navigate = useNavigate()
  const nodeId = () => activeNodeId() ?? ''
  const goBack = (href: string) => {
    const step = narrowBack()
    if (step) step()
    else navigate(href)
  }
  return (
    <header class="mobile-bar mobile-top">
      <Show when={props.back}>
        {(href) => <IconButton icon="arrow-left" label="Back" onPress={() => goBack(href())} />}
      </Show>
      <div class="mobile-title">
        <Text emphasis="strong">{props.title}</Text>
        <Show when={props.detail}>
          <Text emphasis="muted">{props.detail}</Text>
        </Show>
      </div>
      <Show when={nodeState(nodeId()) !== 'online'}>
        <NodeChip nodeId={nodeId()} />
      </Show>
      {props.action}
    </header>
  )
}
