import { For, Show } from 'solid-js'
import type { Project } from '@acorn/plugin-api/client'
import { Badge, Chip, ChipRow, Inline } from '@acorn/plugin-api/ui'

// What this run has added so far: a count and the names. The GitHub step draws it so that importing
// a third repository is not an act of faith, and the add step draws it so someone who came back can
// see what is already in the batch and does not add the same folder twice.
export function AddedTally(props: { added: Project[] }) {
  return (
    <Show when={props.added.length}>
      <Inline gap="stack" wrap>
        <Badge tone="ok">{props.added.length} project{props.added.length === 1 ? '' : 's'} added</Badge>
        <ChipRow ariaLabel="Projects added">
          <For each={props.added}>{(project) => <Chip>{project.name}</Chip>}</For>
        </ChipRow>
      </Inline>
    </Show>
  )
}
