import { Index, Show } from 'solid-js'
import type { AgentToolFileChange } from '@acorn/protocol/extensionPoints.ts'
import { Button, Inline, Stack, StackedDiff, Text } from '@acorn/plugin-api/ui'

// Loaded by an expanded file-tool card, so the diff toolkit stays outside the client's startup graph.
export default function RecordedDiffs(props: { changes: readonly AgentToolFileChange[]; onOpenChanges: () => void }) {
  return <Stack gap="row">
    <Index each={props.changes}>
      {(change) => <Show when={change().patch} fallback={
        <Stack gap="inline">
          <Text emphasis="mono" wrap>{change().path}</Text>
          <Text emphasis="muted">{change().patchArtifactId ? 'This diff is too large to show here.' : 'No recorded diff is available.'}</Text>
        </Stack>
      }>
        <StackedDiff path={change().path} patch={change().patch ?? ''} lineNumbers={!change().snippet} />
      </Show>}
    </Index>
    <Inline><Button variant="bare" size="sm" onPress={props.onOpenChanges}>Open in Changes</Button></Inline>
  </Stack>
}
