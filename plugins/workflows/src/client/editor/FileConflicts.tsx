import { For } from 'solid-js'
import { Alert, Button, Stack, Text, Inline } from '@acorn/plugin-api/ui'
import type { WorkflowDraftStore } from './draftStore'

// What a file review turned up that has to be decided before it can be published. Inline rather than
// in the review dialog, because each choice re-runs the review and the dialog only opens once there is
// an operation to show (./WorkflowEditor.tsx).
export default function FileConflicts(props: { store: WorkflowDraftStore }) {
  return <For each={props.store.fileConflicts()}>{conflict => <Alert tone="warn" title={`File conflict: ${conflict.path}`}>
    <Stack gap="row">
      <Text wrap>{`Your change: ${JSON.stringify(conflict.local)}`}</Text>
      <Text wrap>{`Changed elsewhere: ${JSON.stringify(conflict.external)}`}</Text>
      <Inline gap="inline">
        <Button onPress={() => props.store.resolveFileConflict(conflict.path, 'local')}>Keep your change</Button>
        <Button onPress={() => props.store.resolveFileConflict(conflict.path, 'external')}>Keep external change</Button>
      </Inline>
    </Stack>
  </Alert>}</For>
}
