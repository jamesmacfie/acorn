import { Show } from 'solid-js'
import { fileStatusMeta, formatFileReference, type Task } from '@acorn/plugin-api/client'
import {
  Alert, Badge, Button, ConfirmButton, CopyButton, DiffPane, EmptyState, Input, Inline, Row, Rows,
  Section, Stack, Text, Toolbar,
} from '@acorn/plugin-api/ui'
import type { LocalChange } from '@acorn/protocol/terminal.ts'
import { changeKey, type ChangesModel } from './changesModel'
import { DIFF_LINE_POINT } from './extensionPoints'

// The four regions of the Changes pane: a PR-style "Files changed" view over the task worktree's
// uncommitted changes (docs/diff-rendering.md). The host draws the split, the divider and the drag
// handle; everything the regions share is in ./changesModel.tsx.
//
// The list is a navigator, not a selector: every file's hunks are stacked in one scroller and clicking
// a row scrolls to it, the way the pull-request pane's file list works. The per-file git actions stay
// on the rows, the whole-tree ones sit on the group headers, and commit and push are the footer.

export function ChangesHeader(props: { task: Task; model: ChangesModel }) {
  const model = () => props.model
  return (
    <Toolbar size="sm" ariaLabel="Changes">
      <Text emphasis="muted">{model().isGit() ? 'uncommitted' : 'not a git project'}</Text>
      <Show when={model().project()?.path}>
        {(path) => (
          <>
            <Text emphasis="muted">{path()}</Text>
            <CopyButton text={() => path()} title="Copy project folder" />
          </>
        )}
      </Show>
      <Toolbar.Spacer />
      <Show when={model().unsent().length}>
        <Button
          size="sm"
          title="Bracketed-paste the unsent notes into the task's agent (queued until idle)"
          onPress={() => void model().sendNotes()}
        >
          Send {model().unsent().length} note{model().unsent().length === 1 ? '' : 's'} → agent{model().agentIdle() ? ' ●' : ''}
        </Button>
      </Show>
      <Show when={model().sendMsg()}>{(text) => <Text emphasis="muted">{text()}</Text>}</Show>
    </Toolbar>
  )
}

export function ChangesList(props: { task: Task; model: ChangesModel }) {
  const model = () => props.model

  const FileRow = (rowProps: { change: LocalChange; item: Parameters<Parameters<typeof Rows>[0]['children']>[1] }) => {
    const change = () => rowProps.change
    const status = () => fileStatusMeta(change().status === 'untracked' ? 'added' : change().status)
    // `muted` is the file-status vocabulary's word for "nothing special"; the badge's is `neutral`.
    const tone = (): 'ok' | 'danger' | 'warn' | 'neutral' => {
      const value = status().tone
      return value === 'muted' ? 'neutral' : value
    }
    return (
      <Row
        item={rowProps.item}
        density="compact"
        reveal
        selected={model().isSelected(change())}
        onPress={() => model().select(change())}
        title={change().oldPath ? `${change().oldPath} → ${change().path}` : change().path}
        label={change().path}
        leading={<Badge size="xs" tone={tone()}>{status().letter}</Badge>}
        meta={
          <Show when={change().additions != null}>
            <Text emphasis="muted">+{change().additions} −{change().deletions ?? 0}</Text>
          </Show>
        }
        trailing={
          <>
            <Show
              when={change().staged}
              fallback={
                <>
                  <Button variant="bare" size="sm" iconOnly tip="Stage file" tipSub="git add" onPress={() => void model().stage(change().path)}>+</Button>
                  <ConfirmButton
                    variant="bare"
                    size="sm"
                    iconOnly
                    label="Discard changes"
                    tip="Discard changes"
                    tipSub="Restore this file — cannot be undone"
                    confirmLabel="?"
                    onConfirm={() => void model().discard(change().path, change().status === 'untracked')}
                  >↺</ConfirmButton>
                </>
              }
            >
              <Button variant="bare" size="sm" iconOnly tip="Unstage file" tipSub="git restore --staged" onPress={() => void model().unstage(change().path)}>−</Button>
            </Show>
            <Button
              variant="bare"
              size="sm"
              iconOnly
              tip="Send to agent"
              tipSub="Add file reference to the composer"
              onPress={() => void model().sendRef(formatFileReference(change().path))}
            >→</Button>
          </>
        }
      >
        <Text emphasis="mono">{change().path}</Text>
      </Row>
    )
  }

  const Group = (groupProps: { title: string; staged: boolean; list: readonly LocalChange[] }) => (
    <Show when={groupProps.list.length}>
      <Section
        label={groupProps.title}
        count={groupProps.list.length}
        actions={
          <Show
            when={groupProps.staged}
            fallback={
              <>
                <Button variant="bare" size="sm" iconOnly tip="Stage all" tipSub="git add -A" onPress={() => void model().stageAll()}>++</Button>
                <ConfirmButton
                  variant="bare"
                  size="sm"
                  iconOnly
                  label="Discard all"
                  tip="Discard all"
                  tipSub="Reset tracked + remove untracked — cannot be undone"
                  confirmLabel="?"
                  onConfirm={() => void model().discardAll()}
                >↺</ConfirmButton>
              </>
            }
          >
            <Button variant="bare" size="sm" iconOnly tip="Unstage all" tipSub="git reset" onPress={() => void model().unstageAll()}>−−</Button>
          </Show>
        }
      >
        <Rows
          id={`changes.${props.task.id}.${groupProps.staged ? 'staged' : 'unstaged'}`}
          ariaLabel={groupProps.title}
          items={groupProps.list.map((change) => ({ key: changeKey(change), label: change.path, change }))}
        >
          {(entry, item) => <FileRow change={entry.change} item={item} />}
        </Rows>
      </Section>
    </Show>
  )

  return (
    <Show when={model().isGit()} fallback={<EmptyState title="Not a Git project">Changes are unavailable here.</EmptyState>}>
      <Stack gap="none">
        <Group title="Staged" staged list={model().groups().staged} />
        <Group title="Changes" staged={false} list={model().groups().unstaged} />
        <Show when={!model().groups().staged.length && !model().groups().unstaged.length}>
          <EmptyState>Working tree clean.</EmptyState>
        </Show>
      </Stack>
    </Show>
  )
}

export function ChangesFooter(props: { task: Task; model: ChangesModel }) {
  const model = () => props.model
  return (
    <Show when={model().isGit()}>
      <Stack gap="row">
        <Show when={model().actionError()}>{(error) => <Alert>{error()}</Alert>}</Show>
        <Show when={model().groups().staged.length}>
          <Input
            size="sm"
            label="Commit message"
            placeholder="Commit message"
            value={model().commitMsg()}
            onInput={(value) => model().setCommitMsg(value)}
            onSubmit={() => void model().commit()}
          />
        </Show>
        <Toolbar variant="actions" size="sm">
          <Show when={model().pushMsg()}>{(text) => <Text emphasis="muted">{text()}</Text>}</Show>
          <Inline gap="inline">
            <Show when={model().groups().staged.length}>
              <Button size="sm" disabled={!model().commitMsg().trim()} onPress={() => void model().commit()}>Commit staged</Button>
            </Show>
            <Button size="sm" busy={model().pushing()} tip="Push to origin" tipSub="git push -u origin HEAD" onPress={() => void model().push()}>
              Push → origin
            </Button>
          </Inline>
        </Toolbar>
      </Stack>
    </Show>
  )
}

export function ChangesDiff(props: { task: Task; model: ChangesModel }) {
  const model = () => props.model
  return (
    <Show when={model().isGit()} fallback={<EmptyState>Nothing to diff.</EmptyState>}>
      {/* Marks from other plugins land under the same lines this pane's own review notes do
          (docs/plugins.md § Cooperative extension points, the `annotation` kind). */}
      <DiffPane source={model().source} annotations={DIFF_LINE_POINT} />
    </Show>
  )
}
