import { createMemo, For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import type { PaneLayoutContribution, Task } from '@acorn/plugin-api/client'
import {
  Alert, Button, Chip, ChipRow, EmptyState, Icon, Menu, Sections, Stack,
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
