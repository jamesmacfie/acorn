import { Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Alert, Button, Checkbox, Field, Input, Select } from '../../kit/components/primitives'
import { Inline } from '../../kit/components/layout/Inline'
import { FieldProvider, NO_FIELD } from '../../kit/components/inputs/controlAttrs'
import { Modal } from '../../kit/components/overlays/Modal'
import { Tabs } from '../../kit/components/layout/Tabs'
import { Text } from '../../kit/components/content/Text'
import IconPicker from '../../kit/components/inputs/IconPicker'
import { taskOriginAppearance } from '../tasks/origin'
import type { Task } from '../../infra/queries'
import { BranchOptions } from './BranchOptions'
import { createTaskDraftStore, type TaskDraft } from './taskDraftStore'

export function TaskDraftDialog(props: { draft: TaskDraft; tasks: () => Task[] | undefined; onClose: () => void }) {
  const navigate = useNavigate()
  const model = createTaskDraftStore(props.draft, props.tasks, props.onClose, navigate)
  let titleInput: HTMLInputElement | undefined
  const isNew = props.draft.mode === 'new'
  const fallbackIcon = taskOriginAppearance(props.draft.mode === 'new' ? 'local' : props.draft.task.origin).glyph
  const projectOptions = props.draft.mode === 'new' ? props.draft.projects.map((project) => ({ value: project.id, label: project.name })) : []

  return (
    <Modal title={isNew ? 'New task' : 'Rename task'} autoFocus={() => titleInput} onDismiss={props.onClose}>
      <Show when={isNew && model.selectedProject()?.vcs === 'git'}>
        <Tabs
          tabs={[
            { id: 'new', label: 'New worktree' },
            { id: 'folder', label: 'Project folder' },
            { id: 'worktree', label: 'Existing worktree', count: model.worktrees()?.length },
          ]}
          active={model.source()}
          onChange={(id) => model.setSource(id as 'new' | 'folder' | 'worktree')}
          idPrefix="new-task"
          ariaLabel="Where the task works"
        />
      </Show>
      <Modal.Body>
        <Show when={model.error()}><Alert>{model.error()}</Alert></Show>
        <Show when={isNew}>
          <Field label="Project">
            <Select value={model.projectId()} onChange={model.setProjectId} options={projectOptions} />
          </Field>
        </Show>
        <Field label="Title">
          <Inline gap="inline">
            <FieldProvider value={NO_FIELD}>
              <IconPicker ariaLabel="Task icon" value={model.icon()} fallback={fallbackIcon} onSelect={model.setIcon} />
            </FieldProvider>
            <Input ref={(element) => (titleInput = element)} value={model.text()} onInput={model.setText} onSubmit={() => void model.submit()} />
          </Inline>
        </Field>
        <Show when={isNew && model.selectedProject()?.vcs === 'git'}>
          <div id={`new-task-panel-${model.source()}`} role="tabpanel" aria-labelledby={`new-task-tab-${model.source()}`} style={{ display: 'flex', 'flex-direction': 'column', gap: 'var(--space-5)' }}>
            <Show when={model.source() === 'new'}>
              <BranchOptions
                branch={model.branchTouched() ? model.branchText() : model.checkedAvailability()?.branch ?? model.effectiveBranch()}
                error={model.branchError()}
                checking={model.availability.loading}
                base={model.baseBranch() ?? ''}
                branches={model.branches()}
                onBranch={model.setBranch}
                onBase={model.setBaseBranch}
                onSubmit={() => void model.submit()}
              />
              <Checkbox size="sm" label="Skip setup script" checked={model.skipSetup()} onChange={model.setSkipSetup} />
            </Show>
            <Show when={model.source() === 'folder'}>
              <Text tone="muted" wrap>No new branch. The task uses whatever is checked out in the project folder.</Text>
            </Show>
            <Show when={model.source() === 'worktree'}>
              <Field label="Worktree" hint={model.worktrees.loading ? 'Asking git for worktrees.' : model.worktrees() === null ? 'Could not list the worktrees for this project.' : model.worktrees()?.length ? 'The task uses this folder and its branch. Setup does not run.' : 'Every worktree git lists for this project is already a task.'}>
                <Select value={model.chosenWorktree()?.path ?? ''} onChange={model.setPickedWorktree} disabled={!model.worktrees()?.length} options={(model.worktrees() ?? []).map((worktree) => ({ value: worktree.path, label: worktree.branch, description: worktree.path }))} />
              </Field>
            </Show>
          </div>
        </Show>
      </Modal.Body>
      <Modal.Actions>
        <Button variant="ghost" onPress={props.onClose}>Cancel</Button>
        <Button variant="solid" disabled={!model.canSubmit()} onPress={() => void model.submit()}>{isNew ? 'Create task' : 'Rename'}</Button>
      </Modal.Actions>
    </Modal>
  )
}
