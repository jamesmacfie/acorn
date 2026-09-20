import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { useNavigate, useSearchParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activeTaskId, projectPath, toast, workspacesOptions } from '@acorn/plugin-api/client'
import { addAiList } from './aiListDraft'
import {
  Alert,
  Badge,
  Button,
  DetailColumn,
  Icon,
  Inline,
  Link,
  ListColumn,
  ListDetail,
  Stack,
  Tabs,
  Text,
  Toolbar,
  ToolbarSpacer,
} from '@acorn/plugin-api/ui'
import { AuthoringConversation } from '@acorn/plugin-api/ui/data-sources'
import { workflowsSurfacePath } from '../surfacePath'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { workflowApi } from '../workflowsClient'
import {
  addNode,
  addForEach,
  connect,
  disconnect,
  missingRequiredFields,
  moveNode,
  removeNode,
  select as selectRow,
  setDefinition,
  setField,
  setInputs,
  setStep,
  toJson,
  type DraftSelection,
} from './draft'
import { createDraftStore, defRefKey, SOURCE_GLYPH } from './draftStore'
import FilePublicationReview from './FilePublicationReview'
import GraphView from './GraphView'
import JsonTab from './JsonTab'
import NodeInspector from './NodeInspector'
import NodeList from './NodeList'
import { requestWorkflowStart } from './startRequest'
import { forgetNodeInLayout } from '../layoutPrefs'
import { childWorkflowDefinition, connectCreatedChild } from './childAuthoring'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { AuthoringTurnResult } from '@acorn/protocol/authoring.ts'
import { mergeWorkflow } from '../../shared/workflowMerge'
import { requestWorkflowSchedule } from '../schedules/scheduleRequest'

// The editor: one definition as a list of nodes with an inspector, on both hosts
// (docs/workflows.md § Authoring).
//
// The four regions of a list-detail layout from one file, as plugins/changes' pane does: header, list,
// detail, footer. It is drawn by the Workflows rail source's detail region, which is where a
// project-scoped surface lands on each host.

export default function WorkflowEditor(props: { projectId: string; item?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const store = createDraftStore({ projectId: () => props.projectId, item: () => props.item })
  const [tab, setTab] = createSignal<'nodes' | 'graph' | 'json'>('nodes')
  const workspaces = createQuery(() => workspacesOptions(true))
  const workspaceId = () => workspaces.data?.find((entry) => entry.projects.some((project) => project.id === props.projectId))?.id ?? ''

  const draft = () => store.draft()
  // What the graph's positions are filed under. The same key `layoutPrefs.ts` keeps across a rename,
  // and an empty string for a draft that has no row yet, which reads and writes nothing.
  const layoutId = () => {
    const ref = store.ref()
    return ref ? defRefKey(ref) : ''
  }
  const sourceGlyph = () => {
    const source = store.ref()?.source
    return source ? SOURCE_GLYPH[source] : undefined
  }
  const workflowCatalogKey = () => JSON.stringify(store.catalog()?.workflows ?? [])

  const apply = (change: Parameters<typeof store.apply>[0], coalesce = false): void => store.apply(change, { coalesce })

  const actions = {
    rename: store.rename,
    setField: (name: string, kind: string, fieldId: string, value: unknown) =>
      apply((current) => setField(current, name, kind, fieldId, value), true),
    setStep: (name: string, patch: Parameters<typeof setStep>[2]) => apply((current) => setStep(current, name, patch)),
    setDefinition: (patch: Parameters<typeof setDefinition>[1]) => apply((current) => setDefinition(current, patch), true),
    setInputs: (inputs: Parameters<typeof setInputs>[1]) => apply((current) => setInputs(current, inputs), true),
    connect: (from: string, to: string) => apply((current) => connect(current, from, to)),
    disconnect: (from: string, to: string) => apply((current) => disconnect(current, from, to)),
    remove: (name: string) => {
      apply((current) => removeNode(current, name))
      const ref = store.ref()
      if (ref) forgetNodeInLayout(defRefKey(ref), name)
    },
    addForEach: (sourceId: string) => apply(current => addForEach(current, sourceId)),
    createChild: (stepId: string, itemSchema: DataSchema) => { void createChild(stepId, itemSchema) },
  }

  async function createChild(stepId: string, itemSchema: DataSchema): Promise<void> {
    if (!workspaceId()) {
      store.setMessage('Choose a workspace before creating a child workflow.')
      return
    }
    const parent = store.ref()
    if (!parent) return
    let childId: string | undefined
    try {
      const row = await workflowApi.createDef({
        workspaceId: workspaceId(), projectId: props.projectId,
        def: childWorkflowDefinition(draft().def.name, itemSchema),
      })
      childId = row.id
      const current = draft().def.steps.find(step => (step.id ?? step.name) === stepId)
      if (!current) return
      apply(value => setStep(value, stepId, connectCreatedChild(current, row.id)))
      if (!(await store.save())) {
        await workflowApi.deleteDef(row.id).catch(() => undefined)
        return
      }
      childId = undefined
      await store.refetchCatalog()
      const returnTo = workflowsSurfacePath(props.projectId, defRefKey(parent))
      navigate(`${workflowsSurfacePath(props.projectId, defRefKey({ source: 'database', id: row.id }))}?returnTo=${encodeURIComponent(returnTo)}&returnStep=${encodeURIComponent(stepId)}`)
    } catch (error) {
      if (childId) await workflowApi.deleteDef(childId).catch(() => undefined)
      store.setMessage(error instanceof Error ? error.message : 'The child workflow could not be created.')
    }
  }

  createEffect(() => {
    const stepId = typeof searchParams.step === 'string' ? searchParams.step : undefined
    if (!stepId || store.loading()) return
    if (draft().def.steps.some(step => (step.id ?? step.name) === stepId)) {
      store.select(current => selectRow(current, { kind: 'node', name: stepId }))
    }
  })

  // The node's answer, plus the same required-field question asked here so Save greys out as a box is
  // emptied rather than after the validate debounce (./draft.ts § missingRequiredFields).
  const describeFor = (kind: string) =>
    store.catalog()?.kinds.find((entry) => entry.id === kind)?.describe ?? BUILTIN_STEP_DESCRIPTIONS[kind]
  const missing = createMemo(() => missingRequiredFields(draft().def, describeFor))
  const problems = () => [...missing(), ...store.problems()]
  const counts = createMemo(() => {
    const def = draft().def
    const roots = def.steps.filter((step, index) => (step.after ? step.after.length === 0 : index === 0)).length
    return { nodes: def.steps.length, roots }
  })

  // A draft saves whether or not it validates, the way the store takes one (docs/workflows.md
  // § Database definitions). Greying Save out while a workflow is half-built is how you lose it on
  // the way to the next screen. The footer says what is wrong, and Run is what refuses.
  const canSave = () => !store.readOnly() && store.dirty() && !store.busy()

  const save = async (): Promise<void> => {
    if (!(await store.save())) return
    toast('Workflow saved.')
  }

  // What the owner can generate with: a stored key, or an agent CLI installed on this machine. The
  // AI authoring button is drawn only when there is one, on the rule
  // ../../../changes/src/client/GenerateButton.tsx sets out: a control whose only message is "connect
  // a provider first" is a control in the way of the four beside it, and Settings is where
  // connections are made. A node that cannot answer counts as none.
  const [backends] = createResource(async () => workflowApi.modelBackends().catch(() => []))
  // A project whose workspace is not known counts the same way. The route requires a `workspaceId`
  // and answers 400 without one, which reads as the model having failed rather than as a list that
  // has not arrived. The workspaces query resolves long before a description is typed.
  const canGenerate = () => !store.readOnly() && !!workspaceId() && (backends()?.length ?? 0) > 0
  const [authoringOpen, setAuthoringOpen] = createSignal(false)
  // A row loaded from the node is saved even when its graph is empty. `dirty` also covers a future
  // editor-owned draft before it has a row: once there is work to preserve, authoring can propose an
  // edit without saving or publishing it.
  const applyProposal = async (proposal: Extract<AuthoringTurnResult, { state: 'proposal' }>): Promise<string | undefined> => {
    const current = draft().def
    const base = proposal.base as typeof current
    const proposed = proposal.candidate as typeof current
    const merged = JSON.stringify(current) === JSON.stringify(base)
      ? { value: proposed, conflicts: [] }
      : mergeWorkflow(base, proposed, current)
    if (merged.conflicts.length) {
      return `The draft changed while AI was working. Review these conflicts first: ${merged.conflicts.map(conflict => conflict.path).join(', ')}.`
    }
    const checked = await workflowApi.validateDef(merged.value, props.projectId)
    if (checked.problems.length) return `The reconciled proposal is no longer valid: ${checked.problems.join(' ')}`
    const refused = store.applyText(toJson(merged.value))
    if (refused) return refused
    toast('AI proposal applied. Undo restores the previous draft.')
    return undefined
  }

  // Two steps, because saving to the repository is a decision about where this definition lives from
  // now on (docs/workflows.md § Authoring). The modal asks it; the terminal draws the same one.

  const copyToDatabase = async (): Promise<void> => {
    const id = await store.copyToDatabase(workspaceId())
    if (!id) return
    toast('Copied. This one is yours to edit.')
    navigate(workflowsSurfacePath(props.projectId, defRefKey({ source: 'database', id })))
  }

  const remove = async (): Promise<void> => {
    if (!(await store.remove())) return
    toast('Workflow deleted.')
    navigate(projectPath(props.projectId))
  }

  const run = (): void => {
    const ref = store.ref()
    if (!ref) return
    const executable = ref.source === 'database' ? store.publishedDef() : draft().def
    if (!executable) return
    void requestWorkflowStart({
      defId: ref.source === 'database' ? ref.id : `${ref.source}:${ref.id}`,
      name: executable.name,
      inputs: executable.inputs,
      projectId: props.projectId,
      taskId: activeTaskId() ?? undefined,
    })
  }

  const schedule = (): void => {
    const ref = store.ref()
    const published = store.publishedDef()
    if (!ref || ref.source !== 'database' || !published) return
    requestWorkflowSchedule({
      workflowId: ref.id,
      name: published.name,
      projectId: props.projectId,
      inputs: published.inputs ?? [],
    })
  }

  const publish = async (): Promise<void> => {
    await store.publish()
    await queryClient.invalidateQueries({ queryKey: ['workflow-schedules'] })
  }

  const header = (
    <Toolbar variant="actions" size="sm">
      <Link onPress={() => navigate(projectPath(props.projectId))}>← Workflows</Link>
      <Show when={typeof searchParams.returnTo === 'string' && searchParams.returnTo.startsWith('/p/')}>
        <Link onPress={() => {
          const path = typeof searchParams.returnTo === 'string' ? searchParams.returnTo : ''
          const step = typeof searchParams.returnStep === 'string' ? searchParams.returnStep : ''
          navigate(`${path}?step=${encodeURIComponent(step)}`)
        }}>← Parent workflow</Link>
      </Show>
      <Text emphasis="strong">{draft().def.name}</Text>
      <Show when={sourceGlyph()}>{(glyph) => <Icon name={glyph().icon} title={glyph().title} />}</Show>
      <Show when={!store.readOnly()}><Badge tone={store.dirty() ? 'warn' : undefined}>{store.saveState()}</Badge></Show>
      <ToolbarSpacer />
    </Toolbar>
  )

  // The strip is its own row rather than an item in the bar above, so the three tabs start at the pane's
  // left edge and the buttons sit at its right. In the bar they were one item among ten, which packed
  // the lot into the far corner and left half the width empty. `actions` is the kit's own trailing slot
  // and both hosts draw it (client-core kit/components/layout/Tabs.tsx).
  const tabs = (
    <Tabs
      idPrefix="workflows-editor"
      ariaLabel="Editor view"
      active={tab()}
      tabs={[{ id: 'nodes', label: 'Outline' }, { id: 'graph', label: 'Graph' }, { id: 'json', label: 'Code' }]}
      onChange={(id) => setTab(id as 'nodes' | 'graph' | 'json')}
      actions={(
        <>
          <Show when={canGenerate()}><Button size="sm" disabled={store.busy()} onPress={() => setAuthoringOpen(value => !value)}>AI authoring</Button></Show>
          <Button size="sm" variant="bare" disabled={!store.canUndo()} onPress={store.undo}>Undo</Button>
          <Button size="sm" variant="bare" disabled={!store.canRedo()} onPress={store.redo}>Redo</Button>
          <Show
            when={!store.readOnly()}
            fallback={<Button size="sm" busy={store.busy()} onPress={() => void copyToDatabase()}>Copy to database</Button>}
          >
            <Button size="sm" variant="solid" disabled={!canSave()} busy={store.busy()} onPress={() => void save()}>Save</Button>
            <Button size="sm" disabled={store.busy() || store.conflicts().length > 0} onPress={() => void store.preparePublication()}>Review publication</Button>
            <Show when={store.ref()?.source === 'database'}>
              <Button size="sm" disabled={store.busy() || !store.publishedRevision()} onPress={() => void store.prepareExport()}>Export to repository</Button>
              <Button size="sm" variant="bare" disabled={store.busy()} onPress={() => void remove()}>Delete</Button>
            </Show>
          </Show>
          <Show when={store.ref()?.source === 'database'}>
            <Button size="sm" disabled={!store.publishedRevision()} onPress={schedule}>Schedule…</Button>
          </Show>
          <Button size="sm" disabled={store.ref()?.source === 'database' && !store.publishedRevision()} onPress={run}>Run published…</Button>
        </>
      )}
    />
  )

  const footer = (
    <Toolbar size="sm">
      <Show
        when={problems().length}
        fallback={<Text emphasis="muted">{`Valid · ${counts().nodes} nodes · ${counts().roots} roots`}</Text>}
      >
        <Inline gap="inline" wrap>
          <For each={problems().slice(0, 3)}>
            {(problem) => (
              <Link
                onPress={() => {
                  const named = draft().def.steps.find((step) => problem.includes(`'${step.name}'`))
                  if (named) store.select((current) => selectRow(current, { kind: 'node', name: named.name }))
                }}
              >
                {problem}
              </Link>
            )}
          </For>
          <Show when={problems().length > 3}>
            <Text emphasis="muted">{`and ${problems().length - 3} more`}</Text>
          </Show>
        </Inline>
      </Show>
    </Toolbar>
  )

  return (
    // `grow`, because this stack is the pane: the header and the footer are pinned strips and the
    // region between them is the split, which needs a height of its own before anything in it can
    // scroll. Without it the stack was as tall as whatever the inspector held, so the node list ran
    // off the bottom of the window with nothing to scroll, and the graph and the JSON box got
    // whatever height the list's rows happened to give them.
    <Stack gap="none" grow>
      {header}
      {tabs}
      <Show when={store.message()}>{(message) => <Alert tone="warn">{message()}</Alert>}</Show>
      <Show when={store.ref()?.source === 'database' && !store.publishedRevision()}>
        <Alert tone="warn" title="Run unavailable">
          <Inline gap="inline" wrap>
            <Text>Publish this workflow before running it.</Text>
            <Button size="sm" disabled={store.busy()} onPress={() => void store.preparePublication()}>Review publication</Button>
          </Inline>
        </Alert>
      </Show>
      <Show when={store.ref()?.source === 'database' && store.publishedRevision() && store.dirty()}>
        <Alert title={`Run uses published revision ${store.publishedRevision()}.`}>
          Publish the current draft changes when they are ready to run.
        </Alert>
      </Show>
      <Show when={store.loadError()}><Alert tone="danger">{String(store.loadError())}</Alert></Show>
      <FilePublicationReview store={store} />
      <For each={store.conflicts()}>{conflict => <Alert tone="warn" title={`Conflict: ${conflict.path}`}>
        <Stack gap="row">
          <Text wrap>{`Your change: ${JSON.stringify(conflict.local)}`}</Text>
          <Text wrap>{`Changed elsewhere: ${JSON.stringify(conflict.external)}`}</Text>
          <Inline gap="inline">
            <Button onPress={() => store.resolveConflict(conflict.path, 'local')}>Keep your change</Button>
            <Button onPress={() => store.resolveConflict(conflict.path, 'external')}>Keep external change</Button>
          </Inline>
        </Stack>
      </Alert>}</For>
      <Show when={store.publication()}>{operation => <Alert tone={operation().state === 'complete' ? undefined : 'warn'} title={`Publication: ${operation().state}`}>
        <Stack gap="row">
          <For each={operation().writes}>{write => <Text>{`${write.name} · ${write.kind} · revision ${write.kind === 'workflow' ? write.revision : write.plan.intendedRevision}`}</Text>}</For>
          <Show when={operation().consumers.length}><Text wrap>{`Affected: ${operation().consumers.map(consumer => consumer.name).join(', ')}`}</Text></Show>
          <Show when={operation().error}><Text wrap>{operation().error}</Text></Show>
          <Show when={operation().landed.length}><Text wrap>{`Published: ${operation().landed.map(write => `${write.kind} ${write.id} revision ${write.revision}`).join(', ')}`}</Text></Show>
          <Show when={operation().state !== 'complete'}><Button disabled={store.busy()} onPress={() => void publish()}>{operation().state === 'prepared' ? 'Publish reviewed set' : 'Resume publication'}</Button></Show>
          <Show when={operation().state !== 'complete' && !operation().landed.length}><Button disabled={store.busy()} onPress={() => void store.discardPublication()}>Discard review</Button></Show>
        </Stack>
      </Alert>}</Show>
      <Show when={authoringOpen() && workspaceId()}>
        <AuthoringConversation
          endpoint="/v2/p/workflows/defs/authoring/turn"
          target="workflow"
          targetId={store.ref()?.id ?? `new:${props.projectId}`}
          scope={{ workspaceId: workspaceId(), projectId: props.projectId }}
          baseRevision={store.revision()}
          base={draft().def}
          label={draft().def.name}
          disabled={store.readOnly() || store.busy()}
          onApply={applyProposal}
        />
      </Show>
      <Show when={store.readOnly()}>
        <Show
          when={store.unreadable()}
          fallback={<Alert>This one is a committed file. Copy it to the database to change it.</Alert>}
        >
          <Alert tone="danger">This address does not name a workflow. Go back and pick one from the list.</Alert>
        </Show>
      </Show>
      <Show
        when={tab() !== 'json'}
        fallback={<JsonTab json={store.json()} readOnly={store.readOnly()} onApply={store.applyText} />}
      >
        {/* The list column stays beside the canvas and collapses under it on a narrow layout, which
            is `list-detail`'s own rule rather than anything this pane decides. */}
        <ListDetail split>
          <ListColumn>
            <Show when={workflowCatalogKey()} keyed>{(_catalogKey) => (
              <NodeList
                draft={draft()}
                catalog={store.catalog()}
                readOnly={store.readOnly()}
                onSelect={(selection: DraftSelection) => store.select((current) => selectRow(current, selection))}
                onAdd={(kind) => apply((current) => kind === 'ai-list' ? addAiList(current) : addNode(current, kind))}
                onRemove={actions.remove}
                onMove={(name, direction) => apply(current => moveNode(current, name, direction))}
              />
            )}</Show>
          </ListColumn>
          <DetailColumn scroll={tab() === 'nodes'}>
            <Show
              when={tab() === 'graph'}
              fallback={(
                <NodeInspector
                  draft={draft()}
                  catalog={store.catalog()}
                  providers={store.providers()}
                  projectId={props.projectId}
                  workspaceId={workspaceId()}
                  readOnly={store.readOnly()}
                  actions={actions}
                />
              )}
            >
              <GraphView
                draft={draft()}
                catalog={store.catalog()}
                defId={layoutId()}
                readOnly={store.readOnly()}
                onSelect={(selection: DraftSelection) => store.select((current) => selectRow(current, selection))}
                onConnect={actions.connect}
                onDisconnect={actions.disconnect}
                onRemove={actions.remove}
              />
            </Show>
          </DetailColumn>
        </ListDetail>
      </Show>
      {footer}
    </Stack>
  )
}
