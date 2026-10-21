import { Show, type JSX } from 'solid-js'
import type { FormFactor } from '@acorn/protocol/chrome.ts'
import { isNarrow } from '../../lib/layout/narrowView'
import { HOST, type Host } from '../../tokens/support'

/* Only: children that exist on the named hosts or form factors and nowhere else. For the case where
   there is nothing to draw instead, so no Fallback is wanted. When both lists are given, both must
   match.

   `formFactors` is for content that differs on a phone, such as a button with no words on it. The
   shape of a control on a phone belongs to the kit, so a plugin never needs this to change one. */
export function Only(props: { hosts?: readonly Host[]; formFactors?: readonly FormFactor[]; children: JSX.Element }) {
  const formFactor = (): FormFactor => (HOST === 'tui' ? 'tui' : isNarrow() ? 'narrow' : 'desktop')
  return (
    <Show
      when={
        (!props.hosts || props.hosts.includes(HOST)) && (!props.formFactors || props.formFactors.includes(formFactor()))
      }
    >
      {props.children}
    </Show>
  )
}
