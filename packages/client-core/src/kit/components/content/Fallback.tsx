import { Show, type JSX } from 'solid-js'
import { HOST, NODE_SUPPORT, type KitNode } from '../../tokens/support'

/* Fallback: what to draw in place of a node this host cannot draw.

   Placed inside the node it substitutes for, and named with `forNode` so the decision is data:
   the kit reads the support matrix rather than the author guessing which hosts are short. On the
   DOM host every node is `full`, so this draws nothing today. */
export function Fallback(props: { forNode: KitNode; children: JSX.Element }) {
  const short = () => {
    const level = NODE_SUPPORT[props.forNode][HOST]
    return level === 'fallback' || level === 'absent'
  }
  return <Show when={short()}>{props.children}</Show>
}
