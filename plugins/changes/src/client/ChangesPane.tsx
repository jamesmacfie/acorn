import { createSignal, Show } from 'solid-js'
import { fileStatusMeta, type Task } from '@acorn/plugin-api/client'
import {
  Alert, Badge, Button, Checkbox, DiffPane, EmptyState, Fold, Icon, IconButton, Inline, Menu,
  paneCollapseKey, Row, Rows, SectionHeader, sidebarCollapsed, Stack, Text, Toolbar, TreeRow,
} from '@acorn/plugin-api/ui'
import type { LocalChange } from '@acorn/protocol/localGit.ts'
import { type ChangesModel } from './changesModel'
import { CommitField, CommitOptionsMenu, commitButtonLabel, commitButtonTip, gitCommitLine } from './commitEditor'
import { CommitModal } from './CommitModal'
import { FileTools } from './fileTools'
import { GenerateButton } from './GenerateButton'
import { RemoteBar } from './RemoteBar'
import {
  filesUnder, folderState, stagedState, unstagedPathsOf, visibleNodes, type ChangeView, type FileRow,
  type TreeNode,
} from './model'
import { DIFF_LINE_POINT } from './extensionPoints'

// The four regions of the Changes pane: a PR-style "Files changed" view over the task worktree's
// uncommitted changes (docs/diff-rendering.md). The host draws the split, the divider and the drag
// handle; everything the regions share is in ./changesModel.tsx.
//
// The list is a navigator, not a selector: every file's hunks are stacked in one scroller and clicking
// a row scrolls to it, the way the pull-request pane's file list works. Staging is a checkbox per row
// and per group, the whole-tree button is in the header, and the branch bar, the commit editor and
// the commit button are the footer.

// The badge on a row. `fileStatusMeta` is the host's vocabulary for a diff status and knows nothing
// about a working tree, so the two states only git has get their letters here: `U` is what git itself
// prints for an unmerged file.
const statusMeta = (status: LocalChange['status']) => {
  if (status === 'conflicted') return { letter: 'U', label: 'Conflicted', tone: 'danger' as const }
  const meta = fileStatusMeta(status === 'untracked' ? 'added' : status)
  // `muted` is the file-status vocabulary's word for "nothing special"; the badge's is `neutral`.
  return { ...meta, tone: meta.tone === 'muted' ? ('neutral' as const) : meta.tone }
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const directory = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '')

// How many files the header counts. Conflicts are among them, and their own group says how many.
const changedCount = (model: ChangesModel): number => {
  const groups = model.groups()
  return groups.conflicted.length + groups.tracked.length + groups.untracked.length
}

// Every section the list can draw, in the order it draws them. Conflicts first because a conflict
// blocks everything; then whichever pair or single run the grouping asks for, of which only one set
// is ever present at a time (model.ts § groupSections).
//
// A static list rather than a loop over the sections the model returns: the components below stay
// mounted across a refetch, so roving focus and an open row menu survive one, where a `<For>` over
// freshly built section objects would remount every row on every poll.
const SECTIONS: { key: string; title: string | null }[] = [
  { key: 'conflicted', title: 'Conflicts' },
  { key: 'tracked', title: 'Tracked' },
  { key: 'untracked', title: 'Untracked' },
  { key: 'staged', title: 'Staged' },
  { key: 'unstaged', title: 'Unstaged' },
  { key: 'all', title: null },
]

// The menu's own context, as its children are handed it. Read off `Menu` rather than restated,
// because the type is not on the plugin surface and a copy here would be a second one to keep.
type MenuContext = Parameters<Parameters<typeof Menu>[0]['children']>[0]

// The view menu: the three choices in `ChangeView`, as three runs of radio items.
//
// No heading above a run and no rule between them. Each label carries its own section instead, and
// the check mark says which of a run is chosen.
function ViewMenu(props: { model: ChangesModel }) {
  const view = () => props.model.view()
  const Choice = (own: { menu: MenuContext; chosen: boolean; patch: Partial<ChangeView>; children: string }) => (
    <Menu.Item
      context={own.menu}
      kind="radio"
      checked={own.chosen}
      onSelect={() => props.model.setView(own.patch)}
    >
      {own.children}
    </Menu.Item>
  )
  return (
    <Menu
      ariaLabel="Changes view"
      placement="bottom-end"
      trigger={({ open, toggle }) => (
        <IconButton
          icon="sliders-horizontal"
          label="View options"
          opens="menu"
          expanded={open()}
          onPress={toggle}
        />
      )}
    >
      {(menu) => (
        <>
          <Choice menu={menu} chosen={view().mode === 'list'} patch={{ mode: 'list' }}>List</Choice>
          <Choice menu={menu} chosen={view().mode === 'tree'} patch={{ mode: 'tree' }}>Tree</Choice>
          {/* Absent in tree view, as it is in Zed's: a tree is ordered by its folders, and inside one
              folder sorting by name and sorting by path are the same order. */}
          <Show when={view().mode === 'list'}>
            <Choice menu={menu} chosen={view().sort === 'path'} patch={{ sort: 'path' }}>Sort by path</Choice>
            <Choice menu={menu} chosen={view().sort === 'name'} patch={{ sort: 'name' }}>Sort by name</Choice>
          </Show>
          <Choice menu={menu} chosen={view().groupBy === 'none'} patch={{ groupBy: 'none' }}>No groups</Choice>
          <Choice menu={menu} chosen={view().groupBy === 'tracked'} patch={{ groupBy: 'tracked' }}>
            Group tracked and untracked
          </Choice>
          <Choice menu={menu} chosen={view().groupBy === 'staged'} patch={{ groupBy: 'staged' }}>
            Group staged and unstaged
          </Choice>
        </>
      )}
    </Menu>
  )
}

// The house list header: the label and its count, then the list's own controls. The line totals
// are gone, because every row already carries its own, and Send moved into a banner at the top of
// the list, where it has room to say whether the send worked.
export function ChangesHeader(props: { task: Task; model: ChangesModel }) {
  const model = () => props.model
  return (
    <SectionHeader
      count={model().isGit() ? changedCount(model()) : undefined}
      actions={
        <Show when={model().isGit()}>
          <ViewMenu model={model()} />
          <IconButton
            icon="refresh-cw"
            label="Refresh changes"
            spin={model().status.loading}
            disabled={model().status.loading}
            onPress={() => void model().refresh()}
          />
          {/* One button, not two: there is nothing to stage once everything is staged, and nothing to
              do either way on a clean tree. */}
          <Show when={model().headerStage() === 'stage'}>
            <Button variant="ghost" size="sm" tip="Stage every change" tipSub="git add -A" onPress={() => void model().stageAll()}>
              Stage all
            </Button>
          </Show>
          <Show when={model().headerStage() === 'unstage'}>
            <Button variant="ghost" size="sm" tip="Unstage everything" tipSub="git reset" onPress={() => void model().unstageAll()}>
              Unstage all
            </Button>
          </Show>
        </Show>
      }
    >
      Changes
    </SectionHeader>
  )
}

// The review notes waiting for the agent, and what the last send did. One banner for both, so the
// result of a press lands where the press was.
function NotesBanner(props: { model: ChangesModel }) {
  const model = () => props.model
  const count = () => model().unsent().length
  return (
    <Show when={count() || model().sendMsg()}>
      <Alert
        variant="banner"
        tone={count() ? 'warn' : 'ok'}
        actions={
          <Show when={count()}>
            <Button
              size="sm"
              tip="Sends your unsent notes to this task's agent. If it's busy, they wait until it's free."
              onPress={() => void model().sendNotes()}
            >
              Send to agent
            </Button>
          </Show>
        }
        onDismiss={count() ? undefined : () => model().clearSendMsg()}
      >
        {count() ? `${count()} note${count() === 1 ? '' : 's'} not sent` : ''}
        {count() && model().sendMsg() ? ' ' : ''}
        {model().sendMsg()}
      </Alert>
    </Show>
  )
}

/** What `Rows` hands a row of its collection: the roving tabindex, the id, and the focus callback. */
type RowItem = Parameters<Parameters<typeof Rows>[0]['children']>[1]

/** One section as the model built it, rows and nodes together. */
type Section = ReturnType<ChangesModel['sections']>[number]

export function ChangesList(props: { task: Task; model: ChangesModel }) {
  // Collapsed, the row is the git status letter it already leads with. That badge was always the
  // fastest read in this list, so the rail loses the least of any sidebar in the app: M, A, D, and
  // the path in the tooltip (client-core kit/lib/layout/collapseState.ts).
  const collapsed = sidebarCollapsed(paneCollapseKey('changes'))
  const model = () => props.model

  // One call for a group's checkbox and a folder's, which want the same two things: stage what is not
  // staged yet, or unstage the lot. Unstaging a path that was never staged is a no-op in git, so the
  // second half does not have to filter.
  const setStaged = (rows: readonly FileRow[], staged: boolean) => void (staged
    ? model().stage(unstagedPathsOf(rows))
    : model().unstage(rows.map((row) => row.path)))

  // `depth` is passed straight to the kit row, which is how the tree view nests the same row rather
  // than shipping a second one.
  //
  // No `reveal` on the row, which the hover buttons before it had: `reveal` hides the whole trailing
  // slot until the pointer is over the row, and a checkbox that only appears on hover is a checkbox
  // that cannot say whether the file is staged. `RowActions` brings its own reveal for the verbs,
  // which is what that prop is for (kit/components/layout/RowActions.tsx).
  const FileEntry = (rowProps: {
    row: FileRow
    item: RowItem
    depth?: number
    /** False under a folder row, which already says where the file is. */
    showDirectory?: boolean
  }) => {
    const row = () => rowProps.row
    const meta = () => statusMeta(row().status)
    const conflicted = () => row().group === 'conflicted'
    // The name stays put and the tooltip moves: a checkbox announces its own checked state, and a name
    // that flips to "Unstage" while the box reads checked says the opposite thing twice.
    const stageHint = () => (row().partial ? 'Partly staged. Tick to stage the rest.' : row().staged ? 'Unstage this file' : 'Stage this file')
    return (
      <Row
        item={rowProps.item}
        depth={rowProps.depth}
        density="compact"
        selected={model().isSelected(row().change)}
        onPress={() => model().select(row().change)}
        title={conflicted()
          ? `${row().path} has conflicts. Staging it marks them resolved.`
          : row().oldPath ? `${row().oldPath} → ${row().path}` : row().path}
        label={row().path}
        collapsed={collapsed() ? <Badge size="xs" tone={meta().tone}>{meta().letter}</Badge> : undefined}
        leading={<Badge size="xs" tone={meta().tone}>{meta().letter}</Badge>}
        meta={
          <Show when={row().additions != null}>
            <Text emphasis="muted">+{row().additions} −{row().deletions ?? 0}</Text>
          </Show>
        }
        trailing={
          <>
            <FileTools row={row()} model={model()} />
            {/* Last, so it lines up with the group's box above it. No checkbox on a conflict: there is
                no half of it that can sit in the index while the rest does not, so a tri-state control
                would suggest a state git cannot hold. Marking it resolved is in the overflow menu. */}
            <Show when={!conflicted()}>
              <Checkbox
                size="sm"
                ariaLabel={`Stage ${row().path}`}
                title={stageHint()}
                checked={row().staged}
                indeterminate={row().partial}
                onChange={(checked) => void (checked ? model().stage([row().path]) : model().unstage([row().path]))}
              />
            </Show>
          </>
        }
      >
        <Inline gap="inline">
          <Text emphasis="mono">{fileName(row().path)}</Text>
          <Show when={rowProps.showDirectory !== false && directory(row().path)}>
            {(dir) => <Text emphasis="muted">{dir()}</Text>}
          </Show>
        </Inline>
      </Row>
    )
  }

  // A folder row in tree view. Its checkbox is the group checkbox one level down: checked when
  // everything under it is in the index, indeterminate when some of it is, and toggling it is one
  // call over the descendants that need it.
  const FolderEntry = (rowProps: { node: TreeNode; item: RowItem; staging: boolean }) => {
    const files = () => filesUnder(rowProps.node)
    const state = () => folderState(rowProps.node)
    const expanded = () => model().expanded(rowProps.node.key)
    // The twist and the row itself do the same thing, as they do in Zed: a folder row has nothing to
    // open but itself, so a click anywhere on it that is not the checkbox folds it.
    const toggle = () => void model().foldFolder(rowProps.node.key, !expanded())
    return (
      <TreeRow
        item={rowProps.item}
        depth={rowProps.node.depth}
        expandable
        expanded={expanded()}
        onToggle={toggle}
        onPress={toggle}
        title={rowProps.node.path}
        collapsed={collapsed() ? <Icon name="folder" /> : undefined}
        leading={<Icon name="folder" />}
        trailing={
          <Show when={rowProps.staging}>
            <Checkbox
              size="sm"
              ariaLabel={`Stage all ${rowProps.node.path} files`}
              title={state() === 'all' ? `Unstage all ${rowProps.node.path} files` : `Stage all ${rowProps.node.path} files`}
              checked={state() === 'all'}
              indeterminate={state() === 'some'}
              onChange={(checked) => setStaged(files(), checked)}
            />
          </Show>
        }
      >
        <Text emphasis="mono">{rowProps.node.label}</Text>
      </TreeRow>
    )
  }

  // The rows of one section, flat or nested. Keyed on the mode, because `Rows` reads `tree` once: it
  // decides the container's role and what its left and right arrows mean when the collection is
  // built, so a switch between the two shapes has to build a new one.
  const SectionRows = (own: { section: Section; staging: boolean }) => (
    <Show when={model().view().mode} keyed>
      {(mode) => (
        <Rows
          id={`changes.${props.task.id}.${own.section.key}`}
          ariaLabel={own.section.title ?? 'Changes'}
          tree={mode === 'tree'}
          items={visibleNodes(own.section.nodes, model().closedFolders())
            .map((node) => ({ key: node.key, label: node.label, node }))}
          onExpand={(key, expand) => model().foldFolder(key, expand)}
        >
          {(entry, item) => (entry.node.kind === 'folder'
            ? <FolderEntry node={entry.node} item={item} staging={own.staging} />
            : <FileEntry row={entry.node.row!} item={item} depth={entry.node.depth} showDirectory={mode === 'list'} />)}
        </Rows>
      )}
    </Show>
  )

  const sectionOf = (key: string): Section | undefined => model().sections().find((section) => section.key === key)

  return (
    // Nothing in the list when the folder is not Git: the detail column says so, once.
    <Show when={model().isGit()}>
      <Stack gap="none">
        <NotesBanner model={model()} />
        {SECTIONS.map(({ key, title }) => (
          <Show when={sectionOf(key)}>
            {(section) => {
              // Conflicts have no group control, for the reason the row has no checkbox: unticking it
              // would have to mean "un-resolve", which git does not offer.
              const staging = key !== 'conflicted'
              const state = () => stagedState(section().rows)
              // No fold when the grouping is none. One run of rows needs no header to tell it from
              // the run above, and the control over all of it is the header's Stage all button.
              return title === null
                ? <SectionRows section={section()} staging={staging} />
                : (
                  <Fold
                    label={title}
                    count={section().rows.length}
                    contentIndent="none"
                    persistKey={`changes.${key}`}
                    defaultOpen
                    actions={
                      <Show when={staging}>
                        <Checkbox
                          size="sm"
                          ariaLabel={`Stage all ${title.toLowerCase()} files`}
                          title={state() === 'all' ? `Unstage all ${title.toLowerCase()} files` : `Stage all ${title.toLowerCase()} files`}
                          checked={state() === 'all'}
                          indeterminate={state() === 'some'}
                          onChange={(checked) => setStaged(section().rows, checked)}
                        />
                      </Show>
                    }
                  >
                    <SectionRows section={section()} staging={staging} />
                  </Fold>
                )
            }}
          </Show>
        ))}
        <Show when={model().loaded() && !model().sections().length}>
          <EmptyState align="start" size="sm">No changes</EmptyState>
        </Show>
      </Stack>
    </Show>
  )
}

// The footer, top to bottom: the operation banner, the branch bar, the refusal, the commit editor,
// and the row of buttons under it. That is the order things happen in — see where you are, read what
// went wrong, land the commit — and the reason the bar is drawn above the editor rather than beside
// the commit button.
//
// The editor is always drawn on a git tree, where the one-line field before it appeared only once
// something was staged: with nothing staged the button reads Commit tracked and commits every tracked
// change, which is one fewer click and the rule Zed follows.
export function ChangesFooter(props: { task: Task; model: ChangesModel }) {
  const model = () => props.model
  const [expanded, setExpanded] = createSignal(false)
  return (
    <Show when={model().isGit()}>
      <Stack gap="row">
        <RemoteBar model={model()} />
        <Show when={model().actionError()}>{(error) => <Alert>{error()}</Alert>}</Show>
        {/* Three rows, and no `grow`: the footer sizes to its contents, so a field asking to fill
            the space left over would be a field with none and collapse to nothing. The button beside
            it is how a long message gets room. */}
        <CommitField model={model()} rows={3} />
        <Toolbar variant="actions" size="sm">
          {/* At the left of the row, where Zed's is. Draws nothing until a model provider is
              connected (./GenerateButton.tsx). */}
          <GenerateButton model={model()} />
          <IconButton
            icon="square-pen"
            label="Expand the message"
            tip="Open a bigger editor"
            onPress={() => setExpanded(true)}
          />
          <Toolbar.Spacer />
          <Toolbar.Group joined>
            <Button
              size="sm"
              busy={model().committing()}
              disabled={!model().canCommit()}
              tip={commitButtonTip(model())}
              tipSub={gitCommitLine(model())}
              onPress={() => void model().commit()}
            >
              {commitButtonLabel(model())}
            </Button>
            <CommitOptionsMenu model={model()} />
          </Toolbar.Group>
        </Toolbar>
      </Stack>
      <Show when={expanded()}>
        <CommitModal model={model()} onDismiss={() => setExpanded(false)} />
      </Show>
    </Show>
  )
}

// The detail is never blank: a folder that is not Git and a clean tree each get the centred state.
// The clean check waits for the first status read, so a task that is loading does not flash it.
export function ChangesDiff(props: { task: Task; model: ChangesModel }) {
  const model = () => props.model
  return (
    <Show
      when={model().isGit()}
      fallback={
        <EmptyState title="Not a Git project">
          This folder isn't a Git repository, so there are no changes to show.
        </EmptyState>
      }
    >
      <Show
        when={!model().loaded() || model().sections().length}
        fallback={<EmptyState title="No changes">Everything is committed.</EmptyState>}
      >
        {/* Marks from other plugins land under the same lines this pane's own review notes do
            (docs/plugins.md § Cooperative extension points, the `annotation` kind). */}
        <DiffPane source={model().source} annotations={DIFF_LINE_POINT} />
      </Show>
    </Show>
  )
}
