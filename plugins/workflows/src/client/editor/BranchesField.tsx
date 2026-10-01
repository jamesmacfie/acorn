import { createSignal, Index, Show } from 'solid-js'
import { Button, Field, Icon, Inline, Input, Select, Stack, Text } from '@acorn/plugin-api/ui'

// A `decide` step's branches: a verdict, and the step it takes (docs/workflows.md § Execution model).
//
// Not a `StepField`, because a field is one control and this is a list of pairs. The field vocabulary
// stays closed on purpose and the two shapes it does not cover are drawn by the editor itself, here
// and in the graph connection editor.

export default function BranchesField(props: {
  branches: Readonly<Record<string, string>>
  /** Every step that could be a target: the ones that wait on the deciding step. */
  targets: readonly string[]
  disabled?: boolean
  onChange: (branches: Record<string, string>) => void
}) {
  const [verdict, setVerdict] = createSignal('')
  const rows = () => Object.entries(props.branches)

  const set = (name: string, target: string): void => props.onChange({ ...props.branches, [name]: target })
  const remove = (name: string): void => {
    const { [name]: _gone, ...rest } = props.branches
    props.onChange(rest)
  }
  const add = (): void => {
    const name = verdict().trim()
    if (!name || name in props.branches) return
    setVerdict('')
    set(name, props.targets[0] ?? '')
  }

  return (
    <Field
      label="Branches"
      help="Each answer the agent gives leads to a step. A branch called default catches anything else."
      group
    >
      <Stack gap="row">
        {/* `Index`, not `For`: the pairs are rebuilt on every edit, and `For` keys on identity, so
            each keystroke would remount the row and take the focus with it (docs/frontend.md). */}
        <Index each={rows()}>
          {(row) => (
            <Inline gap="inline">
              <Text>{row()[0]}</Text>
              <Select
                label={`Step for ${row()[0]}`}
                disabled={props.disabled}
                value={row()[1]}
                options={[{ value: '', label: 'Not set' }, ...props.targets.map((step) => ({ value: step, label: step }))]}
                onChange={(next) => set(row()[0], next)}
              />
              <Show when={!props.disabled}>
                <Button size="sm" variant="ghost" onPress={() => remove(row()[0])}>Remove</Button>
              </Show>
            </Inline>
          )}
        </Index>
        <Show when={!props.disabled}>
          <Inline gap="inline">
            <Input
              width="narrow"
              label="New answer"
              assist={false}
              placeholder="Answer"
              value={verdict()}
              onInput={setVerdict}
              onSubmit={add}
            />
            <Button size="sm" onPress={add} disabled={!verdict().trim()}><Icon name="plus" /> Add branch</Button>
          </Inline>
        </Show>
        <Show when={!props.targets.length}>
          <Text emphasis="muted" wrap>Add a step after this one to give a branch somewhere to go.</Text>
        </Show>
      </Stack>
    </Field>
  )
}
