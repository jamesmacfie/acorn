// Repo-level variables for the API panel. Mounted twice: as the Variables view inside the panel,
// and as the "API requests" settings page.
//
// Three kinds:
//   value   - stored and shown as typed
//   secret  - encrypted at rest with the node's secret key. The plaintext never comes back to the
//             renderer, so the field shows a placeholder
//   command - a stored shell command run in the task worktree, or the project checkout, when a
//             request references it. Its output is never stored.
import { Index, Show } from 'solid-js'
import {
  Button, Checkbox, ConfirmButton, Heading, Icon, Inline, Input, Select, Stack, Text,
} from '@acorn/plugin-api/ui/tree'
import { variableKinds, type VariableKind } from '../shared/model'
import type { HttpClient } from './httpClient'
import { createVariableModel } from './variableModel'

const KIND_HINT: Record<VariableKind, string> = {
  value: 'Used exactly as typed.',
  secret: 'Stored encrypted. Leave it blank to keep the saved value.',
  command: "Runs in the task's worktree when a request uses it. The last line it prints is the value.",
}

// The stored kind words stay as they are; only what the select shows changes.
const KIND_LABEL: Record<VariableKind, string> = { value: 'Text', secret: 'Secret', command: 'Command' }

const PLACEHOLDER: Record<VariableKind, string> = {
  value: 'http://localhost:3000',
  secret: '••••••••',
  command: 'op read op://vault/api/token',
}

export default function HttpVariables(props: { client: HttpClient; projectId: string; projectName: string }) {
  const { rows, error, busy, editRow, save, remove, add } = createVariableModel(() => props.client, () => props.projectId)

  return (
    <Stack gap="section">
      <Stack gap="row">
        <Heading level={3}>Variables · {props.projectName}</Heading>
        <Text tone="muted" wrap>
          {'Write {{NAME}} anywhere in a request — the URL, a header, the body, an auth field. '}
          {'A request can override any of these in its own Vars tab. '}
          {'Built in already: {{repo}}, {{branch}}, {{worktree}}, {{taskId}}.'}
        </Text>
      </Stack>

      <Show when={error()}>
        <Text tone="danger" wrap>{error()}</Text>
      </Show>

      {/* One row per variable, as an Inline of controls. It was a five-column CSS grid this plugin
          declared itself; the kit has no grid whose cells are controls, and a row of fields reads the
          same at every width without one. */}
      {/* <Index>, not <For>: rows are keyed by position, so editing one doesn't recreate its input. */}
      <Index each={rows()}>
        {(row, index) => (
          <Stack gap="none">
            <Inline wrap>
              <Checkbox checked={row().enabled} ariaLabel="Enabled" onChange={(checked: boolean) => editRow(index, { enabled: checked })} />
              <Input size="sm" value={row().name} placeholder="BASE_URL" onChange={(value: string) => editRow(index, { name: value })} />
              <Select
                size="sm"
                value={row().kind}
                label="Kind"
                onChange={(value: string) => editRow(index, { kind: value as VariableKind, value: '' })}
                options={variableKinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              />
              <Input
                size="sm"
                type={row().kind === 'secret' ? 'password' : 'text'}
                value={row().value}
                placeholder={row().kind === 'secret' && row().hasStoredSecret ? 'Saved. Leave blank to keep it.' : PLACEHOLDER[row().kind]}
                onChange={(value: string) => editRow(index, { value })}
              />
              <Button size="sm" busy={busy().includes(row().key)} onPress={() => void save(index)}>
                Save
              </Button>
              {/* Index reuses this position after a deletion. Key only the confirmation control by
                  row identity so an armed button cannot move onto another variable. */}
              <Show when={row().key} keyed>
                <ConfirmButton
                  variant="bare"
                  size="sm"
                  title={`Delete ${row().name}`}
                  label="Delete"
                  confirmLabel="Delete variable?"
                  skipConfirm={!row().id}
                  onConfirm={() => void remove(index)}
                ><Icon name="trash-2" /></ConfirmButton>
              </Show>
            </Inline>
            <Text tone="muted">{KIND_HINT[row().kind]}</Text>
          </Stack>
        )}
      </Index>

      {/* Under the list and on its start edge, where the next row will appear. */}
      <Inline>
        <Button size="sm" variant="ghost" onPress={add}>
          <Icon name="plus" /> Add variable
        </Button>
      </Inline>
    </Stack>
  )
}
