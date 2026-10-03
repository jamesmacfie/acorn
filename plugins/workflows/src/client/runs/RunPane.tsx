import { createMemo, createSignal, Show } from 'solid-js'
import { formatRelativeTime, readLocal, type Task, writeLocal } from '@acorn/plugin-api/client'
import {
  Badge, ConfirmButton, EmptyState, Icon, IconButton, Inline, Row, Rows, SectionHeader, SegmentedControl, Stack,
  Text, Toolbar,
} from '@acorn/plugin-api/ui'
import { RunGraph } from './RunGraph'
import { formatUsage, runGlyph, runTone, statusLabel, stepElapsed, stepGlyph, stepTone } from './runDisplay'
import { isLiveRun, type RunPaneModel } from './runPaneModel'

// The run pane's list column: this task's runs, then the selected run's steps in the same reading
// order and the same indentation the editor draws (docs/workflows.md § Routes and UI).
//
// Two `Rows` collections rather than one, because they answer different questions and the arrows
// should not walk from a run into a step. Each is the kit's, so the keyboard, the type-ahead and the
// selection that survives a refetch come for free.
//
// The steps half draws either way: a list, or the kit's `Graph` over the same model. Which one is a
// per-device preference, because it is a reading habit rather than anything about the run
// (docs/state-ownership/scope-rules.md § Particular decisions). A module signal, because the switch sits in the header region
// and the list region draws what it chose.

type NodeView = 'rows' | 'graph'
const NODE_VIEW_KEY = 'plugin:workflows:runs:nodeView'
const CHILD_TERMINAL = new Set(['done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled'])

const [nodeView, setNodeView] = createSignal<NodeView>(readLocal(NODE_VIEW_KEY) === 'graph' ? 'graph' : 'rows')
const showNodes = (view: NodeView): void => {
  writeLocal(NODE_VIEW_KEY, view)
  setNodeView(view)
}

/** The list header: how many runs this task has, and how to draw the selected run's steps. */
export function RunPaneHeader(props: { task: Task; model: RunPaneModel }) {
  return (
    <SectionHeader
      count={props.model.runs().length}
      actions={(
        <Show when={props.model.selectedRun()}>
          <SegmentedControl
            size="sm"
            ariaLabel="Step view"
            value={nodeView()}
            options={[{ value: 'rows' as const, label: 'List' }, { value: 'graph' as const, label: 'Graph' }]}
            onChange={showNodes}
          />
        </Show>
      )}
    >
      Runs
    </SectionHeader>
  )
}

export function RunPaneList(props: { task: Task; model: RunPaneModel }) {
  const model = props.model

  const runItems = createMemo(() => model.runs().map((run) => ({ key: run.id, label: run.name })))
  const nodeItems = createMemo(() => model.nodes().map((node) => ({ key: node.step?.id ?? `pending:${node.name}`, label: node.label })))
  const nodeFor = (key: string) => model.nodes().find((node) => (node.step?.id ?? `pending:${node.name}`) === key)

  const selectNode = (key: string): void => {
    const step = nodeFor(key)?.step
    if (step) model.selectStep(step.id)
  }

  return (
    // Grown only for the graph: its canvas fills whatever height it is given and has none of its own.
    <Stack gap="none" grow={nodeView() === 'graph'}>
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
        <SectionHeader level="group" count={model.nodes().length}>Steps</SectionHeader>
        <Show when={nodeView() === 'graph'}>
          <RunGraph model={model} />
        </Show>
        <Show when={nodeView() === 'rows'}>
          <Rows
            tree
            id={`workflows:nodes:${props.task.id}`}
            ariaLabel="Workflow steps"
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
                    title={node().parents.length > 1 ? `Waits on ${node().parentLabels.join(', ')}` : model.kindLabel(node().step?.kind ?? 'agent')}
                    leading={(
                      <Icon
                        name={stepGlyph(node().step?.status)}
                        tone={stepTone(node().step?.status)}
                        spin={node().step?.status === 'running'}
                      />
                    )}
                    meta={(
                      <Inline gap="inline">
                        <Show when={node().parents.length > 1}>
                          <Badge size="xs">{`⇐ ${node().parents.length}`}</Badge>
                        </Show>
                        {/* The leading check already says done; every other status keeps its word. */}
                        <Show when={node().step?.status !== 'done'}>
                          <Text emphasis="muted">{statusLabel(node().step?.status)}</Text>
                        </Show>
                        <Show when={node().step?.children.length}>
                          {(count) => (
                            <Text emphasis="muted">
                              {`${node().step!.children.filter((child) => child.runStatus && CHILD_TERMINAL.has(child.runStatus)).length} of ${count()} child runs done`}
                            </Text>
                          )}
                        </Show>
                        <Text emphasis="muted">{stepElapsed(node().step, model.now())}</Text>
                      </Inline>
                    )}
                    onPress={() => selectNode(item.key)}
                  >
                    {node().label}
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

/** Under the list: the run's status and what it has cost, and the one control that acts on the
 *  whole run. */
export function RunPaneFooter(props: { task: Task; model: RunPaneModel }) {
  const model = props.model
  const usage = createMemo(() => formatUsage(model.selectedRun()?.usage))
  return (
    <Show when={model.selectedRun()}>
      {(run) => (
        <Toolbar size="sm" ariaLabel="Run status">
          <Text emphasis="muted">{[statusLabel(run().status), usage()].filter(Boolean).join(' · ')}</Text>
          <Toolbar.Spacer />
          <Show
            when={isLiveRun(run())}
            fallback={<IconButton icon="refresh-cw" label="Refresh" size="sm" disabled={model.busy()} onPress={() => model.refresh()} />}
          >
            <ConfirmButton
              size="sm"
              variant="ghost"
              tone="danger"
              confirmLabel="Cancel run?"
              disabled={model.busy()}
              onConfirm={() => void model.cancel()}
            >
              Cancel run
            </ConfirmButton>
          </Show>
        </Toolbar>
      )}
    </Show>
  )
}
