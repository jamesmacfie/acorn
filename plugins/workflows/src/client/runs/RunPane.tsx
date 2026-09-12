import { createMemo, createSignal, Show } from 'solid-js'
import { formatRelativeTime, readLocal, type Task, writeLocal } from '@acorn/plugin-api/client'
import {
  Badge, Button, ConfirmButton, EmptyState, Icon, Row, Rows, SectionHeader, SegmentedControl, Stack,
  Text,
} from '@acorn/plugin-api/ui'
import { RunGraph } from './RunGraph'
import { formatCost, kindLabel, runCost, runGlyph, runTone, stepElapsed, stepGlyph, stepTone } from './runDisplay'
import { isLiveRun, type RunPaneModel } from './runPaneModel'

// The run pane's list column: this task's runs, then the selected run's nodes in the same reading
// order and the same indentation the editor draws (docs/workflows.md § Routes and UI).
//
// Two `Rows` collections rather than one, because they answer different questions and the arrows
// should not walk from a run into a node. Each is the kit's, so the keyboard, the type-ahead and the
// selection that survives a refetch come for free.
//
// The nodes half draws either way: rows, or the kit's `Graph` over the same model. Which one is a
// per-device preference, because it is a reading habit rather than anything about the run
// (docs/state-ownership.md § Device).

type NodeView = 'rows' | 'graph'
const NODE_VIEW_KEY = 'plugin:workflows:runs:nodeView'

/** The list header: how many runs this task has. */
export function RunPaneHeader(props: { task: Task; model: RunPaneModel }) {
  return <SectionHeader count={props.model.runs().length}>Runs</SectionHeader>
}

export function RunPaneList(props: { task: Task; model: RunPaneModel }) {
  const model = props.model
  const [nodeView, setNodeView] = createSignal<NodeView>(readLocal(NODE_VIEW_KEY) === 'graph' ? 'graph' : 'rows')
  const showNodes = (view: NodeView): void => {
    writeLocal(NODE_VIEW_KEY, view)
    setNodeView(view)
  }

  const runItems = createMemo(() => model.runs().map((run) => ({ key: run.id, label: run.name })))
  const nodeItems = createMemo(() => model.nodes().map((node) => ({ key: node.step?.id ?? `pending:${node.name}`, label: node.name })))
  const nodeFor = (key: string) => model.nodes().find((node) => (node.step?.id ?? `pending:${node.name}`) === key)

  const selectNode = (key: string): void => {
    const step = nodeFor(key)?.step
    if (step) model.selectStep(step.id)
  }

  return (
    <Stack gap="none">
      <Show when={model.runs().length} fallback={<EmptyState size="sm" align="start">No runs on this task.</EmptyState>}>
        <Rows
          id={`workflows:runs:${props.task.id}`}
          ariaLabel="Workflow runs"
          items={runItems()}
          selected={model.selectedRunId() ?? null}
          onSelect={(key) => model.selectRun(key)}
          onActivate={(key) => model.selectRun(key)}
        >
          {(item, itemProps, selected) => {
            const run = () => model.runs().find((candidate) => candidate.id === item.key)
            return (
              <Show when={run()}>
                {(current) => (
                  <Row
                    item={itemProps}
                    selected={selected()}
                    density="compact"
                    leading={<Icon name={runGlyph(current().status)} tone={runTone(current().status)} spin={current().status === 'running'} />}
                    meta={<Text emphasis="muted">{formatRelativeTime(current().createdAt)}</Text>}
                    onPress={() => model.selectRun(current().id)}
                  >
                    {current().name}
                  </Row>
                )}
              </Show>
            )
          }}
        </Rows>
      </Show>

      <Show when={model.selectedRun()}>
        <SectionHeader
          level="group"
          count={model.nodes().length}
          actions={(
            <SegmentedControl
              size="sm"
              ariaLabel="Node view"
              value={nodeView()}
              options={[{ value: 'rows' as const, label: 'Rows' }, { value: 'graph' as const, label: 'Graph' }]}
              onChange={showNodes}
            />
          )}
        >
          Nodes
        </SectionHeader>
        <Show when={nodeView() === 'graph'}>
          <RunGraph model={model} />
        </Show>
        <Show when={nodeView() === 'rows'}>
          <Rows
            tree
            id={`workflows:nodes:${props.task.id}`}
            ariaLabel="Workflow nodes"
            items={nodeItems()}
            selected={model.selectedStepId() ?? null}
            onSelect={selectNode}
            onActivate={selectNode}
          >
            {(item, itemProps, selected) => (
              <Show when={nodeFor(item.key)}>
                {(node) => (
                  <Row
                    item={itemProps}
                    selected={selected()}
                    depth={node().depth}
                    density="compact"
                    variant="tree"
                    title={node().parents.length > 1 ? `Waits on ${node().parents.join(', ')}` : kindLabel(node().step?.kind ?? 'agent')}
                    leading={(
                      <Icon
                        name={stepGlyph(node().step?.status)}
                        tone={stepTone(node().step?.status)}
                        spin={node().step?.status === 'running'}
                      />
                    )}
                    meta={(
                      <>
                        <Show when={node().parents.length > 1}>
                          <Badge size="xs">{`⇐ ${node().parents.length}`}</Badge>
                        </Show>
                        <Text emphasis="muted">{node().step?.status ?? 'pending'}</Text>
                        <Text emphasis="muted">{stepElapsed(node().step, model.now())}</Text>
                      </>
                    )}
                    onPress={() => selectNode(item.key)}
                  >
                    {node().name}
                  </Row>
                )}
              </Show>
            )}
          </Rows>
        </Show>
      </Show>
    </Stack>
  )
}

/** Under the list: what the run has cost, and the one control that acts on the whole run. */
export function RunPaneFooter(props: { task: Task; model: RunPaneModel }) {
  const model = props.model
  const cost = createMemo(() => formatCost(runCost(model.steps())))
  return (
    <Show when={model.selectedRun()}>
      {(run) => (
        <SectionHeader
          level="sub"
          actions={(
            <Show
              when={isLiveRun(run())}
              fallback={<Button size="sm" variant="bare" disabled={model.busy()} onPress={() => model.refresh()}>Refresh</Button>}
            >
              <ConfirmButton
                size="sm"
                tone="danger"
                confirmLabel="Cancel it?"
                disabled={model.busy()}
                onConfirm={() => void model.cancel()}
              >
                Cancel run
              </ConfirmButton>
            </Show>
          )}
        >
          {[run().status, cost()].filter(Boolean).join(' · ')}
        </SectionHeader>
      )}
    </Show>
  )
}
