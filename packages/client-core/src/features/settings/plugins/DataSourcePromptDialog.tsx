import { createSignal, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { dataSourceCatalogOptions } from '../../dataSources/queries'
import { Alert, Button, Checkbox, Field, Input } from '../../../kit/components/primitives'
import { Modal } from '../../../kit/components/overlays/Modal'
import { Stack } from '../../../kit/components/layout/Stack'
import { Text } from '../../../kit/components/content/Text'

type Picked = { source: string; name: string }

/** The two questions behind "Build a data source from your connections": what one row is, and which
 *  of the node's sources it reads. The answers become the agent prompt in ./PluginsSettings.tsx. */
export function DataSourcePromptDialog(props: { nodeId: string; onDismiss: () => void; onStart: (row: string, inputs: Picked[]) => void }) {
  const catalog = createQuery(() => dataSourceCatalogOptions(props.nodeId, { parameters: {} }))
  const [row, setRow] = createSignal('')
  const [picked, setPicked] = createSignal<Picked[]>([])
  const toggle = (input: Picked, on: boolean) =>
    setPicked(current => on ? [...current, input] : current.filter(entry => entry.source !== input.source))
  const ready = () => row().trim() !== '' && picked().length > 0

  return (
    <Modal title="Build a data source" size="md" onDismiss={props.onDismiss}>
      <Modal.Body>
        <Stack gap="row">
          <Field label="What should one row be?" hint="For example, an issue in this cycle with its pull request.">
            <Input value={row()} onInput={setRow} />
          </Field>
          <Field label="Which data does it need?" hint="The first one you pick gives one row per record." group>
            <Show when={!catalog.isPending} fallback={<Text emphasis="muted">Reading the sources…</Text>}>
              <Show when={!catalog.isError} fallback={<Alert>Couldn't read this node's sources.</Alert>}>
                <For each={catalog.data?.sources ?? []}>
                  {(source) => {
                    const input = { source: `${source.pluginId}:${source.sourceId}`, name: source.name }
                    return (
                      <Checkbox
                        label={source.name}
                        hint={input.source}
                        checked={picked().some(entry => entry.source === input.source)}
                        onChange={on => toggle(input, on)}
                      />
                    )
                  }}
                </For>
              </Show>
            </Show>
          </Field>
        </Stack>
      </Modal.Body>
      <Modal.Actions>
        <Button variant="ghost" onPress={props.onDismiss}>Cancel</Button>
        <Button variant="solid" disabled={!ready()} onPress={() => props.onStart(row().trim(), picked())}>Start</Button>
      </Modal.Actions>
    </Modal>
  )
}
