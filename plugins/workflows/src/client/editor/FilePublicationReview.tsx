import { For, Show } from 'solid-js'
import { Alert, Button, Stack, Text, Inline } from '@acorn/plugin-api/ui'
import type { WorkflowDraftStore } from './draftStore'

export default function FilePublicationReview(props: { store: WorkflowDraftStore }) {
  return <>
    <For each={props.store.fileConflicts()}>{conflict => <Alert tone="warn" title={`File conflict: ${conflict.path}`}>
      <Stack gap="row">
        <Text wrap>{`Your change: ${JSON.stringify(conflict.local)}`}</Text>
        <Text wrap>{`Changed elsewhere: ${JSON.stringify(conflict.external)}`}</Text>
        <Inline gap="inline">
          <Button onPress={() => props.store.resolveFileConflict(conflict.path, 'local')}>Keep your change</Button>
          <Button onPress={() => props.store.resolveFileConflict(conflict.path, 'external')}>Keep external change</Button>
        </Inline>
      </Stack>
    </Alert>}</For>
    <Show when={props.store.fileOperation()}>{operation => <Alert title={`File publication: ${operation().state}`} tone={operation().state === 'complete' ? undefined : 'warn'}>
      <Stack gap="row">
        <Text wrap>Review these files. Export preserves workspace originals. Files remain uncommitted.</Text>
        <For each={operation().writes}>{write => <Text wrap>{`${write.landed ? 'Written' : 'Pending'}: ${write.path}`}</Text>}</For>
        <For each={operation().setup}>{item => <Text wrap>{item}</Text>}</For>
        <Show when={operation().error}><Text wrap>{operation().error}</Text></Show>
        <Show when={operation().state !== 'complete'}><Button disabled={props.store.busy()} onPress={() => void props.store.publishFiles()}>{operation().state === 'prepared' ? 'Publish reviewed files' : 'Resume file publication'}</Button></Show>
        <Show when={operation().state !== 'complete' && !operation().writes.some(write => write.landed)}><Button disabled={props.store.busy()} onPress={() => void props.store.discardFiles()}>Discard file review</Button></Show>
      </Stack>
    </Alert>}</Show>
  </>
}
