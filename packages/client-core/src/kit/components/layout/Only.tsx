import { Show, type JSX } from 'solid-js'
import { HOST, type Host } from '../../tokens/support'

/* Only: children that exist on the named hosts and nowhere else. For the case where there is
   nothing to draw instead, so no Fallback is wanted.

   Here from the day the kit exists, before there is a second host, so a plugin can be written
   against one before it arrives. */
export function Only(props: { hosts: readonly Host[]; children: JSX.Element }) {
  return <Show when={props.hosts.includes(HOST)}>{props.children}</Show>
}
