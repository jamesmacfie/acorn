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
  Heading,
  Icon,
  IconButton,
  Inline,
  Link,
  ListColumn,
  ListDetail,
  Menu,
  Modal,
  ModalActions,
  ModalBody,
  Stack,
  Tabs,
  Text,
  Toolbar,
  ToolbarSpacer,
} from '@acorn/plugin-api/ui'
import { AuthoringConversation } from '@acorn/plugin-api/ui/data-sources'
import { workflowsSurfacePath } from '../surfacePath'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { unavailableCatalogKind, unavailableStepKindMessage } from '../../shared/stepKindAvailability'
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
import { createDraftStore, defRefKey, SOURCE_GLYPH, type SaveState } from './draftStore'
import { RevealFieldErrors } from './FieldControl'
import FileConflicts from './FileConflicts'
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
    move: (name: string, direction: -1 | 1) => apply(current => moveNode(current, name, direction)),
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
      store.setMessage(error instanceof Error ? error.message : "Couldn't create the child workflow.")
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
  // Both ask the same required-field question, so the node's answer for a field this side already
  // named is dropped. They differ only in the field label's case.
  const missing = createMemo(() => missingRequiredFields(draft().def, describeFor))
  const problems = () => {
    const named = new Set(missing().map((problem) => problem.toLowerCase()))
    return [...missing(), ...store.problems().filter((problem) => !named.has(problem.toLowerCase()))]
  }
  // A required field stays quiet until it is touched, or until Publish or Run asks whether the
  // workflow is ready (./FieldControl.tsx § RevealFieldErrors).
  const [revealErrors, setRevealErrors] = createSignal(false)
  const runnableDefinition = () => store.ref()?.source === 'database' ? store.publishedDef() : draft().def
  const missingRunKind = () => runnableDefinition()?.steps.find((step) => unavailableCatalogKind(step.kind ?? 'agent', store.catalog()))
  const missingDraftKind = () => draft().def.steps.find((step) => unavailableCatalogKind(step.kind ?? 'agent', store.catalog()))

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
      return `You changed the workflow while AI was working. Sort out these steps first: ${[...new Set(merged.conflicts.map(conflict => conflictSubject(conflict.path, current)))].join(', ')}.`
    }
    const checked = await workflowApi.validateDef(merged.value, props.projectId)
    if (checked.problems.length) return `AI's changes no longer fit your workflow: ${checked.problems.join(' ')}`
    const refused = store.applyText(toJson(merged.value))
    if (refused) return refused
    toast("AI's changes applied. Undo puts your version back.")
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

  // Which review dialog is open. Preparing a publication or an export is what opens one, and the
  // prepared operation outlives the dialog: dismissing it keeps the review on the node, and the strip
  // under the header offers it again.
  const [review, setReview] = createSignal<'publication' | 'files'>()
  const pendingPublication = () => {
    const operation = store.publication()
    return operation && operation.state !== 'complete' ? operation : undefined
  }
  const pendingFiles = () => {
    const operation = store.fileOperation()
    return operation && operation.state !== 'complete' ? operation : undefined
  }
  const openPublication = async (): Promise<void> => {
    await store.preparePublication()
    if (pendingPublication()) setReview('publication')
    else if (pendingFiles()) setReview('files')
  }
  const openExport = async (): Promise<void> => {
    await store.prepareExport()
    if (pendingFiles()) setReview('files')
  }
  const confirmPublication = async (): Promise<void> => {
    await publish()
    const operation = store.publication()
    if (operation?.state !== 'complete') return
    setReview(undefined)
    toast('Published.')
  }
  const confirmFiles = async (): Promise<void> => {
    await store.publishFiles()
    if (store.fileOperation()?.state !== 'complete') return
    setReview(undefined)
    if (store.ref()?.source === 'database') toast("Exported. The files aren't committed.")
  }
  const discardReview = async (): Promise<void> => {
    await (review() === 'files' ? store.discardFiles() : store.discardPublication())
    setReview(undefined)
  }

  const isDatabase = () => store.ref()?.source === 'database'
  const runDisabled = () => (isDatabase() && !store.publishedRevision()) || !!missingRunKind()

  // One bar: where you are and what this definition is on the left, what you can do to it on the
  // right. The tab strip under it is only the choice of view. The actions used to sit in the tab
  // strip as nine buttons of four different weights, which pushed the tabs into a corner and left
  // Delete one unconfirmed press from the rest.
  //
  // Three actions stay on the bar because they are the loop: edit, publish, run. Save is there too,
  // though the draft autosaves, because a reader who wants it written now should not have to wait.
  // The rest are rare and go in the overflow menu.
  const header = (
    <Toolbar ariaLabel="Workflow">
      <Show when={typeof searchParams.returnTo === 'string' && searchParams.returnTo.startsWith('/p/')}>
        <Button size="xs" variant="ghost" onPress={() => {
          const path = typeof searchParams.returnTo === 'string' ? searchParams.returnTo : ''
          const step = typeof searchParams.returnStep === 'string' ? searchParams.returnStep : ''
          navigate(`${path}?step=${encodeURIComponent(step)}`)
        }}><Icon name="arrow-left" /> Parent workflow</Button>
      </Show>
      <Heading level={2}>{draft().def.name}</Heading>
      <Show when={sourceGlyph()}>{(glyph) => <Icon name={glyph().icon} title={glyph().title} />}</Show>
      <Show when={!store.readOnly()}>
        <Badge tone={SAVE_BADGE[store.saveState()].tone} tip={SAVE_BADGE[store.saveState()].tip}>{SAVE_BADGE[store.saveState()].word}</Badge>
      </Show>
      {/* Where a run starts from. This badge replaced a warning strip that sat over every new draft
          saying the same thing; an unpublished draft is a normal state, not a problem. */}
      <Show when={isDatabase() && !store.loading()}>
        <Badge tip={store.publishedRevision() ? `Version ${store.publishedRevision()}. Runs and schedules use this version.` : undefined}>
          {store.publishedRevision() ? 'Published' : 'Not published'}
        </Badge>
      </Show>
      <ToolbarSpacer />
      <Show when={canGenerate()}>
        <Button size="sm" disabled={store.busy()} opens="dialog" onPress={() => setAuthoringOpen(true)}>
          <Icon name="sparkles" /> AI authoring
        </Button>
      </Show>
      <IconButton icon="undo-2" label="Undo" disabled={!store.canUndo()} onPress={store.undo} />
      <IconButton icon="redo-2" label="Redo" disabled={!store.canRedo()} onPress={store.redo} />
      <Show
        when={!store.readOnly()}
        fallback={<Button size="sm" busy={store.busy()} onPress={() => void copyToDatabase()}>Make an editable copy</Button>}
      >
        <Button size="sm" disabled={!canSave()} busy={store.busy()} onPress={() => void save()}>Save</Button>
        <Button size="sm" opens="dialog" disabled={store.busy() || store.conflicts().length > 0} onPress={() => { setRevealErrors(true); void openPublication() }}>Publish…</Button>
      </Show>
      <Button
        size="sm"
        variant="solid"
        opens="dialog"
        disabled={runDisabled()}
        tip={isDatabase() && !store.publishedRevision() ? 'Publish this workflow before running it.' : undefined}
        onPress={() => { setRevealErrors(true); run() }}
      >
        Run…
      </Button>
      <Show when={isDatabase() && !store.readOnly()}>
        <Menu
          ariaLabel="More workflow actions"
          placement="bottom-end"
          trigger={({ open, toggle }) => (
            <IconButton icon="ellipsis" label="More actions" opens="menu" expanded={open()} onPress={toggle} />
          )}
        >
          {/* A disabled item takes no hover, so a tip would never show. The reason rides in the label. */}
          {(menu) => (
            <>
              <Menu.Item context={menu} disabled={!store.publishedRevision()} onSelect={schedule}>
                {store.publishedRevision() ? 'Schedule…' : 'Schedule… (publish first)'}
              </Menu.Item>
              <Menu.Item context={menu} disabled={store.busy() || !store.publishedRevision()} onSelect={() => void openExport()}>
                {store.publishedRevision() ? 'Export to repository…' : 'Export to repository… (publish first)'}
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item context={menu} tone="danger" confirm="Delete workflow?" disabled={store.busy()} onSelect={() => void remove()}>
                Delete
              </Menu.Item>
            </>
          )}
        </Menu>
      </Show>
    </Toolbar>
  )

  const tabs = (
    <Tabs
      idPrefix="workflows-editor"
      ariaLabel="Editor view"
      active={tab()}
      tabs={[{ id: 'nodes', label: 'Outline' }, { id: 'graph', label: 'Graph' }, { id: 'json', label: 'Code' }]}
      onChange={(id) => setTab(id as 'nodes' | 'graph' | 'json')}
    />
  )

  // One problem and a count, so the bar stays one line. The problem is a link that selects its step.
  const footer = (
    <Toolbar size="sm">
      <Show
        when={problems()[0]}
        fallback={<Text emphasis="muted">{`${draft().def.steps.length} ${draft().def.steps.length === 1 ? 'step' : 'steps'}, no problems`}</Text>}
      >
        {(problem) => (
          <Inline gap="inline">
            <Link
              onPress={() => {
                const named = draft().def.steps.find((step) => problem().includes(`'${step.name}'`))
                if (named) store.select((current) => selectRow(current, { kind: 'node', name: named.name }))
              }}
            >
              {problem()}
            </Link>
            <Show when={problems().length > 1}>
              <Text emphasis="muted">{`and ${problems().length - 1} more`}</Text>
            </Show>
          </Inline>
        )}
      </Show>
    </Toolbar>
  )

  return (
    // `grow`, because this stack is the pane: the header and the footer are pinned strips and the
    // region between them is the split, which needs a height of its own before anything in it can
    // scroll. Without it the stack was as tall as whatever the inspector held, so the node list ran
    // off the bottom of the window with nothing to scroll, and the graph and the JSON box got
    // whatever height the list's rows happened to give them.
    <RevealFieldErrors.Provider value={revealErrors}>
    <Stack gap="none" grow>
      {header}
      {tabs}
      <Show when={store.message()}>{(message) => <Alert tone="warn">{message()}</Alert>}</Show>
      <Show when={isDatabase() && missingDraftKind()}>
        {(step) => <Alert tone="warn" title="Can't run this workflow">{unavailableStepKindMessage(step().kind ?? 'agent')}</Alert>}
      </Show>
      <Show when={store.loadError()}><Alert tone="danger">{String(store.loadError())}</Alert></Show>
      <FileConflicts store={store} />
      <For each={store.conflicts()}>{conflict => <Alert tone="warn" title={`Conflict: ${conflict.path}`}>
        <Stack gap="row">
          <Text wrap>{`Your change: ${asText(conflict.local)}`}</Text>
          <Text wrap>{`Changed elsewhere: ${asText(conflict.external)}`}</Text>
          <Inline gap="inline">
            <Button onPress={() => store.resolveConflict(conflict.path, 'local')}>Keep mine</Button>
            <Button onPress={() => store.resolveConflict(conflict.path, 'external')}>Keep theirs</Button>
          </Inline>
        </Stack>
      </Alert>}</For>
      {/* A review prepared earlier, or one dismissed without deciding. It stays on the node until it is
          published or discarded, so the reader is told it is there rather than finding it by accident. */}
      <Show when={!review() && (pendingPublication() || pendingFiles())}>
        <Alert title="Publishing isn't finished">
          <Inline gap="inline" wrap>
            <Text>{pendingPublication() ? 'Review it to finish or discard it.' : 'Review the export to finish or discard it.'}</Text>
            <Button size="sm" opens="dialog" onPress={() => setReview(pendingPublication() ? 'publication' : 'files')}>Review</Button>
          </Inline>
        </Alert>
      </Show>
      <Show when={review() === 'publication' && pendingPublication()}>{operation => (
        <Modal title="Publish workflow" size="md" onDismiss={() => setReview(undefined)}>
          <ModalBody>
            <Stack gap="row">
              <Text wrap>Runs and schedules use the published revision. These definitions will be written:</Text>
              <For each={operation().writes}>{write => <Text>{`${write.name} · ${write.kind} · revision ${write.kind === 'workflow' ? write.revision : write.plan.intendedRevision}`}</Text>}</For>
              <Show when={operation().consumers.length}><Text wrap>{`Also affects: ${operation().consumers.map(consumer => consumer.name).join(', ')}`}</Text></Show>
              <Show when={operation().landed.length}><Text wrap>{`Already published: ${operation().landed.map(write => `${write.kind} ${write.id} revision ${write.revision}`).join(', ')}`}</Text></Show>
              <Show when={operation().error ?? store.message()}>{text => <Alert tone="warn">{text()}</Alert>}</Show>
            </Stack>
          </ModalBody>
          <ModalActions>
            <Show when={!operation().landed.length}><Button variant="ghost" disabled={store.busy()} onPress={() => void discardReview()}>Discard review</Button></Show>
            <ToolbarSpacer />
            <Button variant="ghost" onPress={() => setReview(undefined)}>Cancel</Button>
            <Button variant="solid" busy={store.busy()} onPress={() => void confirmPublication()}>{operation().state === 'prepared' ? 'Publish' : 'Resume publishing'}</Button>
          </ModalActions>
        </Modal>
      )}</Show>
      <Show when={review() === 'files' && pendingFiles()}>{operation => (
        <Modal title={isDatabase() ? 'Export to repository' : 'Publish to file'} size="md" onDismiss={() => setReview(undefined)}>
          <ModalBody>
            <Stack gap="row">
              <Text wrap>These files will be written to the working tree and left uncommitted. Files already in the workspace are kept.</Text>
              <For each={operation().writes}>{write => <Text wrap>{`${write.landed ? 'Written' : 'Pending'}: ${write.path}`}</Text>}</For>
              <For each={operation().setup}>{item => <Text wrap>{item}</Text>}</For>
              <Show when={operation().error ?? store.message()}>{text => <Alert tone="warn">{text()}</Alert>}</Show>
            </Stack>
          </ModalBody>
          <ModalActions>
            <Show when={!operation().writes.some(write => write.landed)}><Button variant="ghost" disabled={store.busy()} onPress={() => void discardReview()}>Discard review</Button></Show>
            <ToolbarSpacer />
            <Button variant="ghost" onPress={() => setReview(undefined)}>Cancel</Button>
            <Button variant="solid" busy={store.busy()} onPress={() => void confirmFiles()}>{operation().state === 'prepared' ? 'Write files' : 'Resume writing files'}</Button>
          </ModalActions>
        </Modal>
      )}</Show>
      <Show when={authoringOpen() && workspaceId()}>
        {/* A dialog, not a strip over the editor: the conversation is a side trip from the draft, and
            drawn inline it pushed the outline half off the screen. It keeps its thread on the device,
            so closing it and opening it again picks up where it was. */}
        <Modal title={`AI authoring · ${draft().def.name}`} size="lg" onDismiss={() => setAuthoringOpen(false)}>
          <ModalBody>
            <AuthoringConversation
              bare
              endpoint="/v1/p/workflows/defs/authoring/turn"
              target="workflow"
              targetId={store.ref()?.id ?? `new:${props.projectId}`}
              scope={{ workspaceId: workspaceId(), projectId: props.projectId }}
              baseRevision={store.revision()}
              base={draft().def}
              label={draft().def.name}
              disabled={store.readOnly() || store.busy()}
              onApply={applyProposal}
            />
          </ModalBody>
        </Modal>
      </Show>
      <Show when={store.readOnly()}>
        <Show
          when={store.unreadable()}
          fallback={<Alert>This workflow is a file in the repository. To change it here, make an editable copy.</Alert>}
        >
          <Alert tone="danger">This workflow doesn't exist. Choose one from the list.</Alert>
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
              />
            )}</Show>
          </ListColumn>
          <DetailColumn scroll={tab() === 'nodes'} measure={tab() === 'nodes' ? 'page' : undefined}>
            <Show
              when={tab() === 'graph'}
              fallback={(
                <Show when={workflowCatalogKey()} keyed>{(_catalogKey) => (
                  <NodeInspector
                    draft={draft()}
                    catalog={store.catalog()}
                    providers={store.providers()}
                    projectId={props.projectId}
                    workspaceId={workspaceId()}
                    readOnly={store.readOnly()}
                    actions={actions}
                  />
                )}</Show>
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
    </RevealFieldErrors.Provider>
  )
}

const SAVE_BADGE: Record<SaveState, { word: string; tone?: 'warn' | 'danger'; tip?: string }> = {
  saved: { word: 'Saved' },
  saving: { word: 'Saving…' },
  unsaved: { word: 'Not saved', tone: 'danger', tip: "acorn couldn't reach the node. Your changes are kept on this computer." },
  conflict: { word: 'Resolve save conflict', tone: 'warn' },
}

/** A conflicting value as a person reads it: text as itself, anything else as its JSON. */
const asText = (value: unknown): string =>
  value === undefined ? 'Not set' : typeof value === 'string' ? value : JSON.stringify(value)

/** The step a merge conflict sits in, by name, or the definition field it touches. Merge paths name
 *  a step as `/steps/@{id}` (../../shared/workflowMerge.ts). */
const conflictSubject = (path: string, def: { steps: readonly { id?: string; name: string }[] }): string => {
  const id = /^\/steps\/@([^/]+)/.exec(path)?.[1]
  if (id) return def.steps.find((step) => step.id === id)?.name ?? id
  return path.split('/').filter(Boolean)[0] ?? 'the workflow'
}
