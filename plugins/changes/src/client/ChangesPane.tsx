import { createSignal, Show } from 'solid-js'
import { fileStatusMeta, type Task } from '@acorn/plugin-api/client'
import {
  Alert, Badge, Button, Checkbox, DiffPane, EmptyState, Fold, Icon, Inline, Menu,
  Row, Rows, Stack, Text, Toolbar, TreeRow,
} from '@acorn/plugin-api/ui'
import type { LocalChange } from '@acorn/protocol/terminal.ts'
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
  if (status === 'conflicted') return { letter: 'U', label: 'conflicted', tone: 'danger' as const }
  const meta = fileStatusMeta(status === 'untracked' ? 'added' : status)
  // `muted` is the file-status vocabulary's word for "nothing special"; the badge's is `neutral`.
  return { ...meta, tone: meta.tone === 'muted' ? ('neutral' as const) : meta.tone }
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const directory = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '')

// What the header says about the tree in words, ahead of the line counts. Conflicts get their own
// clause because they are the one state where nothing else in the panel should be the next move.
const summary = (model: ChangesModel): string => {
  const groups = model.groups()
  const count = groups.conflicted.length + groups.tracked.length + groups.untracked.length
  if (!count) return 'working tree clean'
  return `${count} uncommitted${groups.conflicted.length ? `, ${groups.conflicted.length} conflicted` : ''}`
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
// No heading above a run and no rule between them. `Menu.Label` and `Menu.Separator` are DOM-only
// halves of `Menu` — the terminal host's table has neither (apps/tui/src/kit/components.tsx) — so a
// heading here would be a pane that only draws on one of the two hosts. Each label carries its own
// section instead, and the leading `○` or `◉` says which of a run is chosen.
function ViewMenu(props: { model: ChangesModel }) {
  const view = () => props.model.view()
  const Choice = (own: { menu: MenuContext; chosen: boolean; patch: Partial<ChangeView>; children: string }) => (
    <Menu.Item
      context={own.menu}
      // `Menu.Item` has no checked state, so the mark is the whole answer to "which of these am I
      // on". Titled only when it is the chosen one, which is what a reader who cannot see the dot
      // hears.
      leading={<Icon name={own.chosen ? 'circle-dot' : 'circle'} title={own.chosen ? 'Chosen' : undefined} />}
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
        <Button
          variant="bare"
          size="sm"
          iconOnly
          label="View options"
          title="How this list is drawn"
          opens="menu"
          expanded={open()}
          onPress={toggle}
        >
          <Icon name="sliders-horizontal" />
        </Button>
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

export function ChangesHeader(props: { task: Task; model: ChangesModel }) {
  const model = () => props.model
  const counted = () => model().totals().additions > 0 || model().totals().deletions > 0
  return (
    <Toolbar size="sm" ariaLabel="Changes">
      <Text emphasis="muted">{model().isGit() ? summary(model()) : 'not a git project'}</Text>
      <Show when={counted()}>
        <Text emphasis="muted">+{model().totals().additions} −{model().totals().deletions}</Text>
      </Show>
      <Show when={model().isGit()}>
        <ViewMenu model={model()} />
      </Show>
      <Toolbar.Spacer />
      {/* One button, not two: there is nothing to stage once everything is staged, and nothing to do
          either way on a clean tree. */}
      <Show when={model().headerStage() === 'stage'}>
        <Button variant="bare" size="sm" tip="Stage every change" tipSub="git add -A" onPress={() => void model().stageAll()}>
          Stage all
        </Button>
      </Show>
      <Show when={model().headerStage() === 'unstage'}>
        <Button variant="bare" size="sm" tip="Unstage everything" tipSub="git reset" onPress={() => void model().unstageAll()}>
          Unstage all
        </Button>
      </Show>
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

/** What `Rows` hands a row of its collection: the roving tabindex, the id, and the focus callback. */
type RowItem = Parameters<Parameters<typeof Rows>[0]['children']>[1]

/** One section as the model built it, rows and nodes together. */
type Section = ReturnType<ChangesModel['sections']>[number]

export function ChangesList(props: { task: Task; model: ChangesModel }) {
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
    const stageHint = () => (row().partial ? 'Staged, then edited again — stage the rest' : row().staged ? 'Unstage this file' : 'Stage this file')
    return (
      <Row
        item={rowProps.item}
        depth={rowProps.depth}
        density="compact"
        selected={model().isSelected(row().change)}
        onPress={() => model().select(row().change)}
        title={conflicted()
          ? `${row().path} — unmerged; staging it marks the conflict resolved`
          : row().oldPath ? `${row().oldPath} → ${row().path}` : row().path}
        label={row().path}
        leading={<Badge size="xs" tone={meta().tone}>{meta().letter}</Badge>}
        meta={
          <Show when={row().additions != null}>
            <Text emphasis="muted">+{row().additions} −{row().deletions ?? 0}</Text>
          </Show>
        }
        trailing={
          <>
            {/* No checkbox on a conflict: there is no half of it that can sit in the index while the
                rest does not, so a tri-state control would suggest a state git cannot hold. Marking
                it resolved is in the overflow menu. */}
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
            <FileTools row={row()} model={model()} />
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
        leading={<Icon name="folder" />}
        trailing={
          <Show when={rowProps.staging}>
            <Checkbox
              size="sm"
              ariaLabel={`Stage everything under ${rowProps.node.path}`}
              title={state() === 'all' ? `Unstage everything under ${rowProps.node.path}` : `Stage everything under ${rowProps.node.path}`}
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
    <Show when={model().isGit()} fallback={<EmptyState title="Not a Git project">Changes are unavailable here.</EmptyState>}>
      <Stack gap="none">
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
                    persistKey={`changes.${key}`}
                    defaultOpen
                    actions={
                      <Show when={staging}>
                        <Checkbox
                          size="sm"
                          ariaLabel={`Stage everything under ${title}`}
                          title={state() === 'all' ? `Unstage everything under ${title}` : `Stage everything under ${title}`}
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
        <Show when={!model().sections().length}>
          <EmptyState>Working tree clean.</EmptyState>
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
          <Button
            variant="bare"
            size="sm"
            iconOnly
            label="Expand the message"
            title="Write the message in a bigger box"
            onPress={() => setExpanded(true)}
          >
            <Icon name="square-pen" />
          </Button>
          <Toolbar.Spacer />
          <Inline gap="inline">
            <CommitOptionsMenu model={model()} />
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
          </Inline>
        </Toolbar>
      </Stack>
      <Show when={expanded()}>
        <CommitModal model={model()} onDismiss={() => setExpanded(false)} />
      </Show>
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
