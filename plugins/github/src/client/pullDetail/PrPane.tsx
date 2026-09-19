import { createMemo, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import type { Task } from '@acorn/plugin-api/client'
import {
  Alert, Button, EmptyState, Icon, IconButton, Menu, Only, Sections, Stack, Tabs,
} from '@acorn/plugin-api/ui'
import { useChangedFiles } from '../changedFiles'
import { makeContentLinkHandler } from '../contentLinks'
import { requestFileScroll, routeKey } from '../fileNavigation'
import ChecksPanel from '../checks/ChecksPanel'
import { DiffForPull } from '../DiffForPull'
import { PrOverview } from './PrOverview'
import { prSections } from './prSections'
import { prModel, type PrModel } from './prModel'
import { destinationKind, prTabsModel, type PrTabsModel } from './prTabs'
import { pullRefKey, taskPullTabTooltip } from './taskPullTabs'

// The PR pane: one pull request, drawn the way the GitHub browse surface draws one — the navigator
// column beside the diff (../GithubBrowse.tsx). Browse reaches the same pair through its own pull
// list; a task already knows which pull it is about, so the list is a strip of related pulls instead.
//
// A `single` layout holding one kit node, not the host's `list-detail`: the halves are one surface
// with a shared model rather than two regions, and `Sections` is the node that arranges them — folds
// beside the diff on a desktop, a strip of tabs in a terminal
// (client-core/kit/components/layout/Sections.tsx). It is what makes this look like browse rather
// than like a second design, because browse draws the same node from the same list.
//
// A task can be about more than one pull — the one it was made from, the ones that mention it, the
// ones stacked on it — so the navigator opens with the strip that switches between them (./prTabs.ts).
//
// The registration is next door in ./paneContribution.ts, which is what keeps this file — and the
// pull-request model behind it — out of the renderer's first paint.

// A destination a related pull has and this pane does not. The mark on the tab says which one, and
// the control beside the strip is how a reader takes it.
const DESTINATION_ICON = { task: 'list-checks', agent: 'bot', mention: 'link-2', stack: 'git-branch' } as const

/** The strip of pull requests this task is about, and the offer to make a task for one of them. */
function PullStrip(props: { tabs: PrTabsModel }) {
  const tabs = () => props.tabs
  const taskId = () => tabs().task.id
  // Rebuilt when the strip's contents change and never when the selection does. `Tabs` draws with
  // `For`, which remounts a tab it is handed a new object for, and a remount under a keyboard user
  // drops the focus they were moving (docs/ui-design.md).
  const defs = createMemo(() => tabs().tabs().map((tab) => {
    const kind = destinationKind(tab, taskId())
    return {
      id: pullRefKey(tab.pull),
      label: `#${tab.pull.number}`,
      title: taskPullTabTooltip(tab, taskId()),
      ...(kind ? { icon: DESTINATION_ICON[kind] } : {}),
    }
  }))
  const selected = () => tabs().selected()
  const kind = () => {
    const tab = selected()
    return tab ? destinationKind(tab, taskId()) : null
  }
  const linked = () => {
    const tab = selected()
    return tab ? tabs().linkedTaskRows(tab) : []
  }
  return (
    <Stack gap="row">
      {/* Desktop only. In a terminal the strip is a second row competing with the section tabs for
          the same few lines, and the related pulls it switches to are reachable from the pull
          list. */}
      <Only hosts={['dom']}>
        <Show when={tabs().tabs().length > 1}>
          <Tabs
            tabs={defs()}
            active={selected() ? pullRefKey(selected()!.pull) : ''}
            onChange={(id) => tabs().selectTab(id)}
            idPrefix="github-task-pulls"
            ariaLabel="Task pull requests"
            actions={
              <>
                <Show when={kind() === 'task' && linked().length === 1}>
                  <IconButton
                    icon="list-checks"
                    label={`Open ${linked()[0].title}`}
                    onPress={() => tabs().openTask(linked()[0])}
                  />
                </Show>
                <Show when={kind() === 'task' && linked().length > 1}>
                  <Menu
                    ariaLabel={`Tasks linked to #${selected()!.pull.number}`}
                    trigger={({ toggle }) => (
                      <IconButton icon="list-checks" label="Choose linked task" onPress={toggle} />
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
                  <IconButton
                    icon="bot"
                    label="Open creating agent session"
                    onPress={() => tabs().openAgent(selected()!)}
                  />
                </Show>
                <Show when={tabs().offersTaskCreation()}>
                  <Button
                    size="sm"
                    disabled={tabs().creatingTask() || !tabs().canCreateTask()}
                    tip={tabs().taskCreationTitle()}
                    onPress={() => void tabs().createSelectedTask()}
                  >{tabs().creatingTask() ? 'Creating…' : '+ Task'}</Button>
                </Show>
              </>
            }
          />
        </Show>
      </Only>
      <Show when={tabs().taskError()}>{(text) => <Alert>{text()}</Alert>}</Show>
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
    <Show when={model()} fallback={<EmptyState align="start" busy>Loading…</EmptyState>}>
      {(loaded) => (
        <>
          <Sections
            id="github.pull"
            ariaLabel="Pull request"
            header={{
              id: 'details',
              label: 'Details',
              render: () => (
                <Stack gap="section">
                  <PullStrip tabs={tabs} />
                  <PrOverview model={loaded()} onOpenFile={select} onLinkClick={onLinkClick} />
                </Stack>
              ),
            }}
            sections={prSections({
              model: loaded(),
              currentFile: changedFiles.currentFile,
              onOpenFile: select,
              onLinkClick,
            })}
            main={{
              id: 'diff',
              label: 'Diff',
              render: () => (
                <DiffForPull
                  route={{
                    owner: loaded().scope.owner,
                    repo: loaded().scope.repo,
                    number: loaded().scope.number,
                    key: routeKey(loaded().scope.owner, loaded().scope.repo, loaded().scope.number),
                  }}
                  router={false}
                  taskId={props.task.id}
                  readOnly={!tabs.isPrimary()}
                />
              ),
            }}
          />
          {/* The one overlay this pane owns. It is a run's step log, opened from a check row. */}
          <Show when={loaded().openCheck()}>
            {(check) => (
              <ChecksPanel
                owner={loaded().scope.owner}
                repo={loaded().scope.repo}
                runId={check().runId}
                jobName={check().name}
                onClose={() => loaded().setOpenCheck(null)}
              />
            )}
          </Show>
        </>
      )}
    </Show>
  )
}

