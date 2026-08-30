import { createMemo, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import type { PaneLayoutContribution, Task } from '@acorn/plugin-api/client'
import {
  Alert, Button, Chip, ChipRow, DetailColumn, EmptyState, Fold, Icon, ListColumn, ListDetail, Menu,
  SectionHeader, Stack,
} from '@acorn/plugin-api/ui'
import { useChangedFiles } from '../changedFiles'
import { makeContentLinkHandler } from '../contentLinks'
import { requestFileScroll, routeKey } from '../fileNavigation'
import ChecksPanel from '../checks/ChecksPanel'
import { DiffForPull } from '../DiffForPull'
import { PrConversation } from './Conversation'
import { PrFileList } from './PrFiles'
import { PrOverview } from './PrOverview'
import { prModel, type PrModel } from './prModel'
import { destinationKind, prTabsModel, type PrTabsModel } from './prTabs'
import { pullRefKey, taskPullTabTooltip } from './taskPullTabs'

// The PR pane: one pull request, drawn the way the GitHub browse surface draws one — the navigator
// column beside the diff (../GithubBrowse.tsx). Browse reaches the same pair through its own pull
// list; a task already knows which pull it is about, so the list is a strip of related pulls instead.
//
// A `single` layout holding the kit's split, not the host's `list-detail`: the two columns are one
// surface with a shared model rather than two regions, which is exactly the case the kit's ListDetail
// exists for, and it is what makes this look like browse rather than like a second design
// (docs/panes.md § Layout model).
//
// A task can be about more than one pull — the one it was made from, the ones that mention it, the
// ones stacked on it — so the navigator opens with the strip that switches between them (./prTabs.ts).

const PANE_ID = 'pr'

/** The strip of pull requests this task is about, and the offer to make a task for one of them. */
function PullStrip(props: { tabs: PrTabsModel }) {
  const tabs = () => props.tabs
  const taskId = () => tabs().task.id
  return (
    <Stack gap="row">
      <Show when={tabs().tabs().length > 1}>
        <ChipRow ariaLabel="Task pull requests">
          <For each={tabs().tabs()}>
            {(tab) => {
              const kind = () => destinationKind(tab, taskId())
              const linked = () => tabs().linkedTaskRows(tab)
              const glyph = () => kind() === 'mention' ? 'link-2' : kind() === 'stack' ? 'git-branch' : null
              return (
                <>
                  <Chip
                    selected={tabs().selectedKey() === pullRefKey(tab.pull)}
                    title={taskPullTabTooltip(tab, taskId())}
                    leading={<Show when={glyph()}>{(name) => <Icon name={name()} size={12} />}</Show>}
                    onPress={() => tabs().selectTab(tab)}
                  >#{tab.pull.number}</Chip>
                  <Show when={kind() === 'task' && linked().length === 1}>
                    <Button
                      variant="bare"
                      size="sm"
                      iconOnly
                      label={`Open ${linked()[0].title}`}
                      onPress={() => tabs().openTask(linked()[0])}
                    ><Icon name="list-checks" size={13} /></Button>
                  </Show>
                  <Show when={kind() === 'task' && linked().length > 1}>
                    <Menu
                      ariaLabel={`Tasks linked to #${tab.pull.number}`}
                      trigger={({ toggle }) => (
                        <Button variant="bare" size="sm" iconOnly label="Choose linked task" onPress={toggle}>
                          <Icon name="list-checks" size={13} />
                        </Button>
                      )}
                    >
                      {(menu) => (
                        <For each={linked()}>
                          {(linkedTask) => (
                            <Menu.Item context={menu} onSelect={() => tabs().openTask(linkedTask)} leading={<Icon name="list-checks" size={13} />}>
                              {linkedTask.title}
                            </Menu.Item>
                          )}
                        </For>
                      )}
                    </Menu>
                  </Show>
                  <Show when={kind() === 'agent'}>
                    <Button
                      variant="bare"
                      size="sm"
                      iconOnly
                      label="Open creating agent session"
                      onPress={() => tabs().openAgent(tab)}
                    ><Icon name="bot" size={13} /></Button>
                  </Show>
                </>
              )
            }}
          </For>
          <Show when={tabs().offersTaskCreation()}>
            <Button
              size="sm"
              disabled={tabs().creatingTask() || !tabs().canCreateTask()}
              tip={tabs().taskCreationTitle()}
              onPress={() => void tabs().createSelectedTask()}
            >{tabs().creatingTask() ? 'Creating…' : '+ Task'}</Button>
          </Show>
        </ChipRow>
      </Show>
      <Show when={tabs().taskError()}>{(text) => <Alert>{text()}</Alert>}</Show>
    </Stack>
  )
}

/** The navigator column: the same three trees browse stacks, over the pull strip. */
function PrNavigator(props: {
  model: PrModel
  current: () => string | undefined
  onSelect: (path: string) => void
  onLinkClick: (event: MouseEvent) => void
}) {
  const model = () => props.model
  return (
    <Stack gap="section">
      <PrOverview model={model()} onOpenFile={props.onSelect} onLinkClick={props.onLinkClick} />
      <Fold persistKey="files" defaultOpen label="Files" count={model().files().length}>
        <PrFileList model={model()} current={props.current} onSelect={props.onSelect} />
      </Fold>
      <Fold
        persistKey="conversation"
        defaultOpen
        label="Comments/Commits"
        count={model().conversationEntries().length}
      >
        <PrConversation model={model()} onOpenFile={props.onSelect} onLinkClick={props.onLinkClick} />
      </Fold>
      {/* The one overlay this pane owns. It is a run's step log, opened from a check row. */}
      <Show when={model().openCheck()}>
        {(check) => (
          <ChecksPanel
            owner={model().scope.owner}
            repo={model().scope.repo}
            runId={check().runId}
            jobName={check().name}
            onClose={() => model().setOpenCheck(null)}
          />
        )}
      </Show>
    </Stack>
  )
}

export function PrPane(props: { task: Task }) {
  const navigate = useNavigate()
  const tabs = prTabsModel(props.task)
  const model = createMemo<PrModel | null>(() => {
    const pull = tabs.selected()?.pull
    if (!pull) return null
    return prModel({
      owner: pull.owner,
      repo: pull.repo,
      number: pull.number,
      taskId: props.task.id,
      readOnly: !tabs.isPrimary(),
    })
  })
  const onLinkClick = makeContentLinkHandler(navigate, { taskId: props.task.id })
  // A pane has no router, so the selected file is held locally and the diff column hears about it
  // through the file-scroll event rather than through `?file=` (../changedFiles.ts).
  const changedFiles = useChangedFiles(
    () => {
      const pull = tabs.selected()?.pull
      return pull ? { owner: pull.owner, repo: pull.repo, number: pull.number } : null
    },
    { router: false },
  )
  const select = (path: string) => {
    changedFiles.selectFile(path)
    const pull = tabs.selected()?.pull
    if (pull) requestFileScroll({ routeKey: routeKey(pull.owner, pull.repo, pull.number), path })
  }

  return (
    <ListDetail split listWidth="wide">
      {/* No "Navigator" header: the tree under it opens with the pull's own heading, which names the
          column better than a label ever did. The same call browse makes. */}
      <ListColumn scroll label="Pull request">
        <PullStrip tabs={tabs} />
        <Show when={model()} fallback={<EmptyState align="start" busy>Loading…</EmptyState>}>
          {(loaded) => (
            <PrNavigator
              model={loaded()}
              current={changedFiles.currentFile}
              onSelect={select}
              onLinkClick={onLinkClick}
            />
          )}
        </Show>
      </ListColumn>
      <DetailColumn>
        <SectionHeader>Diff</SectionHeader>
        <Show when={tabs.selected()?.pull} fallback={<EmptyState align="start" busy>Loading…</EmptyState>}>
          {(pull) => (
            <DiffForPull
              route={{
                owner: pull().owner,
                repo: pull().repo,
                number: pull().number,
                key: routeKey(pull().owner, pull().repo, pull().number),
              }}
              router={false}
              taskId={props.task.id}
              readOnly={!tabs.isPrimary()}
            />
          )}
        </Show>
      </DetailColumn>
    </ListDetail>
  )
}

export const prPaneContribution: PaneLayoutContribution = {
  id: PANE_ID,
  label: 'PR review',
  glyph: 'git-pull-request',
  description: 'Overview, files & diff',
  order: 10,
  defaultChord: 'meta+shift+r',
  when: (task) => task.pullNumber != null,
  minWidth: 520,
  layout: 'single',
  regions: { body: PrPane },
}
