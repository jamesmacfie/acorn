import { createMemo, createResource, createSignal, For, Index, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { activeTaskId, projectPath, toast, workspacesOptions } from '@acorn/plugin-api/client'
import {
  Alert,
  Badge,
  Button,
  DetailColumn,
  Inline,
  Link,
  ListColumn,
  ListDetail,
  Modal,
  ModalActions,
  ModalBody,
  Stack,
  Tabs,
  Text,
  Toolbar,
  ToolbarSpacer,
} from '@acorn/plugin-api/ui'
import { workflowsSurfacePath } from '../surfacePath'
import type { WorkflowGenerateNote, WorkflowGenerateResult } from '../../shared/api'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { workflowApi } from '../workflowsClient'
import {
  addNode,
  connect,
  disconnect,
  missingRequiredFields,
  removeNode,
  select as selectRow,
  setDefinition,
  setField,
  setInputs,
  setStep,
  toJson,
  type DraftSelection,
} from './draft'
import { createDraftStore, defRefKey } from './draftStore'
import GenerateModal from './GenerateModal'
import GraphView from './GraphView'
import JsonTab from './JsonTab'
import NodeInspector from './NodeInspector'
import NodeList from './NodeList'
import { requestWorkflowStart } from './startRequest'
import { forgetNodeInLayout } from '../layoutPrefs'

// The editor: one definition as a list of nodes with an inspector, on both hosts
// (docs/workflows.md § Authoring).
//
// The four regions of a list-detail layout from one file, as plugins/changes' pane does: header, list,
// detail, footer. It is drawn by the Workflows rail source's detail region, which is where a
// project-scoped surface lands on each host.

export default function WorkflowEditor(props: { projectId: string; item?: string }) {
  const navigate = useNavigate()
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
  const sourceLabel = () => (store.ref()?.source === 'database' ? 'database' : store.ref()?.source ?? '')

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
  }

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
  // Generate button is drawn only when there is one, on the rule
  // ../../../changes/src/client/GenerateButton.tsx sets out: a control whose only message is "connect
  // a provider first" is a control in the way of the four beside it, and Settings is where
  // connections are made. A node that cannot answer counts as none.
  const [backends] = createResource(async () => workflowApi.modelBackends().catch(() => []))
  // A project whose workspace is not known counts the same way. The route requires a `workspaceId`
  // and answers 400 without one, which reads as the model having failed rather than as a list that
  // has not arrived. The workspaces query resolves long before a description is typed.
  const canGenerate = () => !store.readOnly() && !!workspaceId() && (backends()?.length ?? 0) > 0
  const [generating, setGenerating] = createSignal(false)
  const [notes, setNotes] = createSignal<WorkflowGenerateNote[]>([])

  // Through the same door the JSON tab's Apply uses, so a whole generated definition is one entry on
  // the undo stack rather than none or a dozen.
  const applyGenerated = (result: WorkflowGenerateResult): void => {
    setGenerating(false)
    const refused = store.applyText(toJson(result.def))
    if (refused) {
      store.setMessage(refused)
      return
    }
    setNotes(result.notes)
    toast('Workflow generated.')
  }

  // Two steps, because saving to the repository is a decision about where this definition lives from
  // now on (docs/workflows.md § Authoring). The modal asks it; the terminal draws the same one.
  const [askingRepo, setAskingRepo] = createSignal(false)
  const saveToRepo = async (keepRow: boolean): Promise<void> => {
    setAskingRepo(false)
    const path = await store.saveToRepo({ taskId: activeTaskId() ?? undefined, keepRow })
    if (!path) return
    toast(keepRow ? `Written to ${path}. The copy here is still yours to edit.` : `Written to ${path}.`)
    if (!keepRow) navigate(projectPath(props.projectId))
  }

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
    void requestWorkflowStart({
      defId: ref.source === 'database' ? ref.id : `${ref.source}:${ref.id}`,
      name: draft().def.name,
      inputs: draft().def.inputs,
      projectId: props.projectId,
      taskId: activeTaskId() ?? undefined,
    })
  }

  const header = (
    <Toolbar variant="actions" size="sm">
      <Link onPress={() => navigate(projectPath(props.projectId))}>← Workflows</Link>
      <Text emphasis="strong">{draft().def.name}</Text>
      <Show when={sourceLabel()}>{(label) => <Badge>{label()}</Badge>}</Show>
      <Show when={store.dirty()}><Badge tone="warn">unsaved</Badge></Show>
      <ToolbarSpacer />
      <Tabs
        idPrefix="workflows-editor"
        ariaLabel="Editor view"
        active={tab()}
        tabs={[{ id: 'nodes', label: 'Nodes' }, { id: 'graph', label: 'Graph' }, { id: 'json', label: 'JSON' }]}
        onChange={(id) => setTab(id as 'nodes' | 'graph' | 'json')}
      />
      <Show when={canGenerate()}>
        <Button size="sm" disabled={store.busy()} onPress={() => setGenerating(true)}>Generate</Button>
      </Show>
      <Button size="sm" variant="bare" disabled={!store.canUndo()} onPress={store.undo}>Undo</Button>
      <Button size="sm" variant="bare" disabled={!store.canRedo()} onPress={store.redo}>Redo</Button>
      <Show
        when={!store.readOnly()}
        fallback={<Button size="sm" busy={store.busy()} onPress={() => void copyToDatabase()}>Copy to database</Button>}
      >
        <Button size="sm" variant="solid" disabled={!canSave()} busy={store.busy()} onPress={() => void save()}>Save</Button>
        <Button size="sm" disabled={store.busy()} onPress={() => setAskingRepo(true)}>Save to repo</Button>
        <Button size="sm" variant="bare" disabled={store.busy()} onPress={() => void remove()}>Delete</Button>
      </Show>
      <Button size="sm" onPress={run}>Run…</Button>
    </Toolbar>
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
      <Show when={store.message()}>{(message) => <Alert tone="warn">{message()}</Alert>}</Show>
      <Show when={askingRepo()}>
        <Modal onDismiss={() => setAskingRepo(false)} title="Save this workflow into the repository" size="sm">
          <ModalBody>
            <Text wrap>
              It is written to .acorn/workflows in the task's checkout, where a reviewer can read it in a
              pull request. From then on the repository's trust snapshot covers it, so the next run from
              the file asks you to acknowledge it.
            </Text>
          </ModalBody>
          <ModalActions>
            <Button variant="bare" onPress={() => setAskingRepo(false)}>Cancel</Button>
            <Button onPress={() => void saveToRepo(false)}>Write it and delete the copy here</Button>
            <Button variant="solid" onPress={() => void saveToRepo(true)}>Write it and keep both</Button>
          </ModalActions>
        </Modal>
      </Show>
      <Show when={generating()}>
        <GenerateModal
          backends={backends() ?? []}
          context={{
            workspaceId: workspaceId(),
            // Only a row can be an example of itself: the worked examples the node picks are rows.
            ...(store.ref()?.source === 'database' ? { defId: store.ref()?.id } : {}),
            name: draft().def.name,
            ...(draft().def.inputs ? { inputs: draft().def.inputs } : {}),
          }}
          onDismiss={() => setGenerating(false)}
          onGenerated={applyGenerated}
        />
      </Show>
      {/* Above the list rather than in a toast: a list of things that were changed is not something
          to read in three seconds. What the definition still gets wrong is the footer's job. */}
      <Show when={notes().length}>
        <Alert
          tone="warn"
          title="Changed before this was applied"
          // Dismissed through `actions` rather than `onDismiss`, which the terminal host's `Alert`
          // accepts and draws nothing for. One prop, one control, both hosts.
          actions={<Button size="sm" variant="bare" onPress={() => setNotes([])}>Dismiss</Button>}
        >
          <Stack gap="row">
            <Index each={notes()}>{(note) => <Text wrap>{note().message}</Text>}</Index>
          </Stack>
        </Alert>
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
            <NodeList
              draft={draft()}
              catalog={store.catalog()}
              readOnly={store.readOnly()}
              onSelect={(selection: DraftSelection) => store.select((current) => selectRow(current, selection))}
              onAdd={(kind) => apply((current) => addNode(current, kind))}
              onRemove={actions.remove}
            />
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
