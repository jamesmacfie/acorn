import { For, type JSX } from 'solid-js'
import { DescriptionList } from '../primitives'

/* Facts: label-and-value pairs in auto-fitting tiles. `DescriptionList layout="facts"` had four
   users (linear, rollbar, docker, onboarding) and no name; this is the name.

   Values take JSX because a fact is often a Badge or a StatusDot, but labels are strings: a fact
   whose label needs markup is a Row.

   `grouping` is how the pairs sit together: `tiles` fits as many label-over-value tiles across as the
   box allows, and `rows` is the two-column table, label beside value, one pair per line. Tiles want
   width; a narrow pane reads better as rows, which is why a caller picks rather than the box guessing.

   At 80×24: two columns, the labels dim. */
export function Facts(props: {
  /** `wide` spans the whole row in the tiles layout, for a value no single tile can hold. */
  items: readonly { label: string; value: JSX.Element; mono?: boolean; wide?: boolean }[]
  size?: 'sm' | 'md'
  grouping?: 'tiles' | 'rows'
}) {
  return (
    <DescriptionList layout={props.grouping === 'rows' ? 'columns' : 'facts'} size={props.size}>
      <For each={props.items}>
        {(item) => (
          <DescriptionList.Item label={item.label} mono={item.mono} wide={item.wide}>{item.value}</DescriptionList.Item>
        )}
      </For>
    </DescriptionList>
  )
}
