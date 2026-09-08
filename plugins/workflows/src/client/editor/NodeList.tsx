import { createMemo, For, Show } from 'solid-js'
import { Badge, Button, ConfirmButton, Icon, Menu, Row, Rows, SectionHeader, Text } from '@acorn/plugin-api/ui'
import type { WorkflowCatalog } from '../../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { DEFINITION_ROW, effectiveAfter, graphOrder, INPUTS_ROW, type DraftSelection, type WorkflowDraft } from './draft'

// The list column: the definition, its inputs, and the graph in reading order.
//
// One list, not two, because the inspector's subject is whatever is selected here and the definition's
// own fields need a row to be selected from. The graph rows are indented by rank and a node waiting on
// more than one step says how many, which is the only thing a list can say that a picture says better
// (docs/future/workflows/phase-6-canvas.md).

const kindLabel = (kind: string, catalog: WorkflowCatalog | undefined): string =>
  catalog?.kinds.find((entry) => entry.id === kind)?.describe?.label ?? BUILTIN_STEP_DESCRIPTIONS[kind]?.label ?? kind

const kindIcon = (kind: string, catalog: WorkflowCatalog | undefined): string | undefined =>
  catalog?.kinds.find((entry) => entry.id === kind)?.describe?.icon ?? BUILTIN_STEP_DESCRIPTIONS[kind]?.icon

export default function NodeList(props: {
  draft: WorkflowDraft
  catalog: WorkflowCatalog | undefined
  readOnly?: boolean
  onSelect: (selection: DraftSelection) => void
  onAdd: (kind: string) => void
  onRemove: (name: string) => void
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
    { key: DEFINITION_ROW, label: def().name || 'Definition' },
    { key: INPUTS_ROW, label: 'Inputs' },
    ...order().map((row) => ({ key: `node:${row.name}`, label: row.name })),
  ])

  const rowFor = (key: string) => order().find((row) => `node:${row.name}` === key)
  const stepFor = (name: string) => def().steps.find((step) => step.name === name)

  const select = (key: string): void => {
    if (key === DEFINITION_ROW) return props.onSelect({ kind: 'definition' })
    if (key === INPUTS_ROW) return props.onSelect({ kind: 'inputs' })
    props.onSelect({ kind: 'node', name: key.slice('node:'.length) })
  }

  const selectedNode = () => (props.draft.selection.kind === 'node' ? props.draft.selection.name : undefined)
  const selectedHasEdges = () => {
    const name = selectedNode()
    if (!name) return false
    const index = def().steps.findIndex((step) => step.name === name)
    return effectiveAfter(def(), index).length > 0
      || def().steps.some((_step, at) => effectiveAfter(def(), at).includes(name))
  }

  // Built-in kinds first, then each plugin's, which is the order somebody reaches for them in.
  const grouped = createMemo(() => [...(props.catalog?.kinds ?? [])].sort((a, b) =>
    (a.pluginId ?? '').localeCompare(b.pluginId ?? '') || a.id.localeCompare(b.id)))

  return (
    <>
      <SectionHeader
        actions={(
          <Show when={!props.readOnly}>
            <Menu
              ariaLabel="Add a step"
              trigger={(state) => (
                <Button size="sm" opens="menu" expanded={state.open()} onPress={state.toggle}>+ Add</Button>
              )}
            >
              {/* Built-in kinds first, then one run per plugin. The owner rides in each row's title
                  rather than in a heading: the kit's menu has no heading node on both hosts. */}
              {(menu) => (
                <For each={grouped()}>
                  {(kind) => (
                    <Menu.Item
                      context={menu}
                      title={kind.describe?.description ?? (kind.pluginId ? `From ${kind.pluginId}` : undefined)}
                      leading={<Show when={kind.describe?.icon}>{(name) => <Icon name={name()} />}</Show>}
                      onSelect={() => props.onAdd(kind.id)}
                    >
                      {kind.describe?.label ?? kind.id}
                    </Menu.Item>
                  )}
                </For>
              )}
            </Menu>
            <ConfirmButton
              size="sm"
              variant="bare"
              disabled={!selectedNode()}
              skipConfirm={!selectedHasEdges()}
              confirmLabel="Delete it?"
              onConfirm={() => {
                const name = selectedNode()
                if (name) props.onRemove(name)
              }}
            >
              Delete
            </ConfirmButton>
          </Show>
        )}
      >
        Nodes
      </SectionHeader>
      <Rows
        tree
        id="workflows.editor.nodes"
        ariaLabel="Workflow nodes"
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
                depth={row().depth + 1}
                density="compact"
                variant="tree"
                title={row().parents.length > 1 ? `Waits on ${row().parents.join(', ')}` : undefined}
                leading={<Show when={kindIcon(stepFor(row().name)?.kind ?? 'agent', props.catalog)}>{(name) => <Icon name={name()} />}</Show>}
                meta={(
                  <>
                    <Show when={row().parents.length > 1}>
                      <Badge size="xs">{`⇐ ${row().parents.length}`}</Badge>
                    </Show>
                    <Text emphasis="muted">{kindLabel(stepFor(row().name)?.kind ?? 'agent', props.catalog)}</Text>
                  </>
                )}
              >
                {row().name}
              </Row>
            )}
          </Show>
        )}
      </Rows>
    </>
  )
}
