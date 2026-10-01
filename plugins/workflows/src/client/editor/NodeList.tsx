import { stepIdentity } from '../../shared/workflowIdentity'
import { createMemo, For, Show } from 'solid-js'
import { pluginLabel } from '@acorn/plugin-api/client'
import { Badge, Button, Icon, Menu, Row, Rows, SectionHeader, Stack, Text } from '@acorn/plugin-api/ui'
import type { WorkflowCatalog } from '../../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { DEFINITION_ROW, graphOrder, INPUTS_ROW, type DraftSelection, type WorkflowDraft } from './draft'
import { branchLabel, stepSummary } from './outlineModel'

// The list column: the definition, its inputs, and the graph in reading order.
//
// One list, not two, because the inspector's subject is whatever is selected here and the definition's
// own fields need a row to be selected from. A row indents only where the graph forks
// (./graphOrder.ts), and a node waiting on more than one step says how many. This list stays beside
// the graph view rather than being replaced by it: it is the one place the definition's own rows can
// be selected from (./GraphView.tsx). Moving and deleting the selected step live in the inspector's
// header, beside the step they act on.

const kindIcon = (kind: string, catalog: WorkflowCatalog | undefined): string | undefined =>
  catalog?.kinds.find((entry) => entry.id === kind)?.describe?.icon ?? BUILTIN_STEP_DESCRIPTIONS[kind]?.icon

/** The built-in kinds, by what they are for. A kind not named here falls into Flow. Plugin kinds get a
 *  group each, under the plugin's name. */
const BUILTIN_GROUPS: readonly { label: string; kinds: readonly string[] }[] = [
  { label: 'Ask AI', kinds: ['agent', 'decide', 'ci-loop', 'ai-list'] },
  { label: 'Records', kinds: ['find-records', 'get-record-details', 'workflow-map'] },
  { label: 'Flow', kinds: ['if', 'gate-human', 'gate-policy', 'workflow'] },
]

/** Not a catalog kind: two steps the editor adds together (./aiListDraft.ts). */
const AI_LIST = { id: 'ai-list', label: 'Ask AI for a list, then run each', icon: 'sparkles', description: undefined as string | undefined }

type AddItem = { id: string; label: string; icon: string; description?: string }

export default function NodeList(props: {
  draft: WorkflowDraft
  catalog: WorkflowCatalog | undefined
  readOnly?: boolean
  onSelect: (selection: DraftSelection) => void
  onAdd: (kind: string) => void
}) {
  const def = () => props.draft.def
  const order = createMemo(() => graphOrder(def()))
  const selectedKey = () => {
    const selection = props.draft.selection
    if (selection.kind === 'definition') return DEFINITION_ROW
    if (selection.kind === 'inputs') return INPUTS_ROW
    return `node:${selection.name}`
  }

  const items = createMemo(() => [
    { key: DEFINITION_ROW, label: def().name || 'Definition', summary: '', icon: '' },
    { key: INPUTS_ROW, label: 'Inputs', summary: '', icon: '' },
    ...order().map((row) => {
      const step = def().steps.find(candidate => stepIdentity(candidate) === row.name)!
      return {
        key: `node:${row.name}`,
        label: step.name ?? row.name,
        summary: stepSummary(step, def(), props.catalog),
        icon: kindIcon(step.kind ?? 'agent', props.catalog) ?? '',
      }
    }),
  ])

  const rowFor = (key: string) => order().find((row) => `node:${row.name}` === key)
  const stepFor = (name: string) => def().steps.find((step) => stepIdentity(step) === name)

  const select = (key: string): void => {
    if (key === DEFINITION_ROW) return props.onSelect({ kind: 'definition' })
    if (key === INPUTS_ROW) return props.onSelect({ kind: 'inputs' })
    props.onSelect({ kind: 'node', name: key.slice('node:'.length) })
  }

  // Grouped by what a step is for, then one group per plugin, each sorted by label: the list used to
  // run in plugin-then-id order, which read as no order at all.
  const groups = createMemo(() => {
    const kinds = props.catalog?.kinds ?? []
    const item = (kind: (typeof kinds)[number]): AddItem => ({
      id: kind.id,
      label: kind.describe?.label ?? kind.id,
      icon: kind.describe?.icon ?? 'puzzle',
      description: kind.describe?.description,
    })
    const byLabel = (a: AddItem, b: AddItem) => a.label.localeCompare(b.label)
    const builtins = kinds.filter((kind) => !kind.pluginId)
    const named = new Set(BUILTIN_GROUPS.flatMap((group) => group.kinds))
    const builtinGroups = BUILTIN_GROUPS.map((group) => ({
      label: group.label,
      items: [
        ...builtins.filter((kind) => group.kinds.includes(kind.id)).map(item),
        ...(group.kinds.includes(AI_LIST.id) ? [AI_LIST] : []),
        ...(group.label === 'Flow' ? builtins.filter((kind) => !named.has(kind.id)).map(item) : []),
      ].sort(byLabel),
    }))
    const plugins = [...new Set(kinds.flatMap((kind) => (kind.pluginId ? [kind.pluginId] : [])))]
      .map((pluginId) => ({
        label: pluginLabel(pluginId),
        items: kinds.filter((kind) => kind.pluginId === pluginId).map(item).sort(byLabel),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return [...builtinGroups, ...plugins].filter((group) => group.items.length)
  })

  return (
    <>
      <SectionHeader
        actions={(
          <Show when={!props.readOnly}>
            <Menu
              ariaLabel="Add a step"
              trigger={(state) => (
                <Button size="sm" opens="menu" expanded={state.open()} onPress={state.toggle}><Icon name="plus" /> Add step</Button>
              )}
            >
              {(menu) => (
                <For each={groups()}>
                  {(group, index) => (
                    <>
                      <Show when={index() > 0}><Menu.Separator /></Show>
                      <Menu.Label>{group.label}</Menu.Label>
                      <For each={group.items}>
                        {(kind) => (
                          <Menu.Item
                            context={menu}
                            title={kind.description}
                            leading={<Icon name={kind.icon} />}
                            onSelect={() => props.onAdd(kind.id)}
                          >
                            {kind.label}
                          </Menu.Item>
                        )}
                      </For>
                    </>
                  )}
                </For>
              )}
            </Menu>
          </Show>
        )}
      >
        Steps
      </SectionHeader>
      <Rows
        tree
        id="workflows.editor.nodes"
        ariaLabel="Workflow outline"
        items={items()}
        selected={selectedKey()}
        onSelect={select}
        onActivate={select}
      >
        {(item, itemProps, selected) => (
          <Show
            when={rowFor(item.key)}
            fallback={(
              <Row
                item={itemProps}
                selected={selected()}
                onPress={() => select(item.key)}
                density="compact"
                leading={<Icon name={item.key === DEFINITION_ROW ? 'workflow' : 'list'} />}
                meta={(
                  <Show when={item.key === INPUTS_ROW}>
                    <Text emphasis="muted">{String((def().inputs ?? []).length)}</Text>
                  </Show>
                )}
              >
                {item.key === DEFINITION_ROW ? 'Definition' : 'Inputs'}
              </Row>
            )}
          >
            {(row) => (
              <Row
                item={itemProps}
                selected={selected()}
                onPress={() => select(item.key)}
                depth={row().depth + 1}
                density="compact"
                variant="stacked"
                title={row().parents.length > 1 ? `Waits on ${row().parents.map((parent) => stepFor(parent)?.name ?? parent).join(', ')}` : undefined}
                leading={<Show when={item.icon}>{(name) => <Icon name={name()} />}</Show>}
                meta={(
                  <>
                    <Show when={branchLabel(stepFor(row().name)!, def())}>{label => <Badge size="xs">{label()}</Badge>}</Show>
                    <Show when={row().parents.length > 1}>
                      <Badge size="xs">{`⇐ ${row().parents.length}`}</Badge>
                    </Show>
                  </>
                )}
              >
                <Stack gap="none">
                  <Text>{stepFor(row().name)?.name ?? row().name}</Text>
                  <Text emphasis="muted">{item.summary}</Text>
                </Stack>
              </Row>
            )}
          </Show>
        )}
      </Rows>
      {/* The list is never empty — Definition and Inputs are always in it — so a new workflow needs
          telling that the thing it is missing is a step. */}
      <Show when={!def().steps.length && !props.readOnly}>
        <Row density="compact">
          <Text emphasis="muted" wrap>No steps yet. Add one to start.</Text>
        </Row>
      </Show>
    </>
  )
}
