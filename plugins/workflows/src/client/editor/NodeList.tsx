import { stepIdentity } from '../../shared/workflowIdentity'
import { createMemo, For, Show } from 'solid-js'
import { Badge, Button, ConfirmButton, Icon, Menu, Row, Rows, SectionHeader, Stack, Text } from '@acorn/plugin-api/ui'
import type { WorkflowCatalog } from '../../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { DEFINITION_ROW, effectiveAfter, graphOrder, INPUTS_ROW, type DraftSelection, type WorkflowDraft } from './draft'
import { branchLabel, dependencyLabels, referenceLabels, stepSummary } from './outlineModel'

// The list column: the definition, its inputs, and the graph in reading order.
//
// One list, not two, because the inspector's subject is whatever is selected here and the definition's
// own fields need a row to be selected from. The graph rows are indented by rank and a node waiting on
// more than one step says how many. This list stays beside the graph view rather than being replaced
// by it: it is the one place the definition's own rows can be selected from (./GraphView.tsx).

const kindIcon = (kind: string, catalog: WorkflowCatalog | undefined): string | undefined =>
  catalog?.kinds.find((entry) => entry.id === kind)?.describe?.icon ?? BUILTIN_STEP_DESCRIPTIONS[kind]?.icon

export default function NodeList(props: {
  draft: WorkflowDraft
  catalog: WorkflowCatalog | undefined
  readOnly?: boolean
  onSelect: (selection: DraftSelection) => void
  onAdd: (kind: string) => void
  onRemove: (name: string) => void
  onMove: (name: string, direction: -1 | 1) => void
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
    { key: DEFINITION_ROW, label: def().name || 'Definition', summary: '', icon: '', dependencies: '' },
    { key: INPUTS_ROW, label: 'Inputs', summary: '', icon: '', dependencies: '' },
    ...order().map((row) => {
      const step = def().steps.find(candidate => stepIdentity(candidate) === row.name)!
      const dependencies = dependencyLabels(step, def())
      return {
        key: `node:${row.name}`,
        label: step.name ?? row.name,
        summary: stepSummary(step, def(), props.catalog),
        icon: kindIcon(step.kind ?? 'agent', props.catalog) ?? '',
        dependencies: dependencies.length ? `After ${dependencies.join(', ')}` : 'Starts the run',
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

  const selectedNode = () => (props.draft.selection.kind === 'node' ? props.draft.selection.name : undefined)
  const selectedHasEdges = () => {
    const name = selectedNode()
    if (!name) return false
    const index = def().steps.findIndex((step) => stepIdentity(step) === name)
    return effectiveAfter(def(), index).length > 0
      || def().steps.some((_step, at) => effectiveAfter(def(), at).includes(name))
  }
  const selectedReferences = () => selectedNode() ? referenceLabels(selectedNode()!, def()) : []
  const selectedIndex = () => def().steps.findIndex(step => stepIdentity(step) === selectedNode())

  // Built-in kinds first, then each plugin's, which is the order somebody reaches for them in.
  const grouped = createMemo(() => [...(props.catalog?.kinds ?? [])].sort((a, b) =>
    (a.pluginId ?? '').localeCompare(b.pluginId ?? '') || a.id.localeCompare(b.id)))

  return (
    <>
      <SectionHeader
        actions={(
          <Show when={!props.readOnly}>
            <Button size="sm" variant="bare" iconOnly label="Move up" title="Move selected step up" disabled={selectedIndex() <= 0}
              onPress={() => selectedNode() && props.onMove(selectedNode()!, -1)}><Icon name="arrow-up" /></Button>
            <Button size="sm" variant="bare" iconOnly label="Move down" title="Move selected step down" disabled={selectedIndex() < 0 || selectedIndex() >= def().steps.length - 1}
              onPress={() => selectedNode() && props.onMove(selectedNode()!, 1)}><Icon name="arrow-down" /></Button>
            <Menu
              ariaLabel="Add a step"
              trigger={(state) => (
                <Button size="sm" opens="menu" expanded={state.open()} onPress={state.toggle}>+ Add</Button>
              )}
            >
              {/* Built-in kinds first, then one run per plugin. The owner rides in each row's title
                  rather than in a heading: the kit's menu has no heading node on both hosts. */}
              {(menu) => (
                <>
                <Menu.Item context={menu} onSelect={() => props.onAdd('ai-list')}>
                  Plan with AI, then For each
                </Menu.Item>
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
                </>
              )}
            </Menu>
            <ConfirmButton
              size="sm"
              variant="bare"
              disabled={!selectedNode()}
              skipConfirm={!selectedHasEdges() && !selectedReferences().length}
              confirmLabel={selectedReferences().length ? `Remove ${selectedReferences().length} references?` : 'Delete it?'}
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
        Outline
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
                variant="tree"
                title={row().parents.length > 1 ? `Waits on ${row().parents.join(', ')}` : undefined}
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
                  <Text emphasis="muted" wrap>{item.summary}</Text>
                  <Text emphasis="muted" wrap>{item.dependencies}</Text>
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
          <Text emphasis="muted">No steps yet. Add the first one above.</Text>
        </Row>
      </Show>
      <Show when={selectedReferences().length}>
        <Row density="compact" variant="stacked">
          <Text emphasis="muted" wrap>{`Deleting this step affects ${selectedReferences().join(', ')}.`}</Text>
        </Row>
      </Show>
    </>
  )
}
