import { For, type JSX } from 'solid-js'
import { DescriptionList } from './primitives'

/* Facts: label-and-value pairs in auto-fitting tiles. `DescriptionList layout="facts"` had four
   users (linear, rollbar, docker, onboarding) and no name; this is the name.

   Values take JSX because a fact is often a Badge or a StatusDot, but labels are strings: a fact
   whose label needs markup is a Row.

   At 80×24: two columns, the labels dim. */
export function Facts(props: {
  items: readonly { label: string; value: JSX.Element; mono?: boolean }[]
  size?: 'sm' | 'md'
}) {
  return (
    <DescriptionList layout="facts" size={props.size}>
      <For each={props.items}>
        {(item) => (
          <DescriptionList.Item label={item.label} mono={item.mono}>{item.value}</DescriptionList.Item>
        )}
      </For>
    </DescriptionList>
  )
}
