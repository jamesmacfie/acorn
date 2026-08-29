import { createMemo, For, Show, type JSX } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import type { PaneLayoutContribution, Task } from '@acorn/plugin-api/client'
import { Alert, Button, Chip, ChipRow, EmptyState, Icon, Menu, Stack } from '@acorn/plugin-api/ui'
import { selectPaneTab } from '@acorn/plugin-api/ui/host'
import { useChangedFiles } from '../changedFiles'
import { makeContentLinkHandler } from '../contentLinks'
import { requestFileScroll, routeKey } from '../fileNavigation'
import ChecksPanel from '../checks/ChecksPanel'
import { PrConversation } from './Conversation'
import { PrFilesTab } from './PrFiles'
import { PrOverview } from './PrOverview'
import { prModel, type PrModel } from './prModel'
import { destinationKind, prTabsModel, type PrTabsModel } from './prTabs'
import { pullRefKey, taskPullTabTooltip } from './taskPullTabs'

// The PR pane: one pull request as a `tabs` layout, with Overview, Conversation and Files as the
// three panels the host mounts one at a time (docs/panes.md § Layout model).
//
// A task can be about more than one pull — the one it was made from, the ones that mention it, the
// ones stacked on it — so every panel opens with the strip that switches between them. The strip is
// in the panels rather than beside the tab bar because the bar is the host's, and which pull is
// showing is shared state rather than chrome (./prTabs.ts).

const PANE_ID = 'pr'
const FILES_TAB = 'files'

/** Everything a panel needs: the pull strip, the pull's model, and how this surface opens a file. */
function usePr(task: Task) {
  const navigate = useNavigate()
  const tabs = prTabsModel(task)
  const model = createMemo<PrModel | null>(() => {
    const pull = tabs.selected()?.pull
    if (!pull) return null
    return prModel({
      owner: pull.owner,
      repo: pull.repo,
      number: pull.number,
      taskId: task.id,
      readOnly: !tabs.isPrimary(),
    })
  })
  const onLinkClick = makeContentLinkHandler(navigate, { taskId: task.id })
  // Show a file in the diff from a panel that is not the diff's. The scroll target is an event the
  // viewer listens for, and the tab is the host's selection, so this is two asks and no state.
  const openFile = (path: string) => {
    const pull = tabs.selected()?.pull
    if (pull) requestFileScroll({ routeKey: routeKey(pull.owner, pull.repo, pull.number), path })
    selectPaneTab(PANE_ID, FILES_TAB)
  }
  return { tabs, model, onLinkClick, openFile }
}

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

/** The strip over whichever panel asked for it. Every panel opens the same way. */
function Panel(props: { task: Task; children: (context: ReturnType<typeof usePr>, model: PrModel) => JSX.Element }) {
  const context = usePr(props.task)
  return (
    <Stack gap="section">
      <PullStrip tabs={context.tabs} />
      <Show when={context.model()} fallback={<EmptyState align="start" busy>Loading…</EmptyState>}>
        {(model) => props.children(context, model())}
      </Show>
    </Stack>
  )
}

function PrOverviewPanel(props: { task: Task }) {
  return (
    <Panel task={props.task}>
      {(context, model) => (
        <>
          <PrOverview model={model} onOpenFile={context.openFile} onLinkClick={context.onLinkClick} />
          {/* The one overlay this pane owns. It is a run's step log, opened from a check row. */}
          <Show when={model.openCheck()}>
            {(check) => (
              <ChecksPanel
                owner={model.scope.owner}
                repo={model.scope.repo}
                runId={check().runId}
                jobName={check().name}
                onClose={() => model.setOpenCheck(null)}
              />
            )}
          </Show>
        </>
      )}
    </Panel>
  )
}

function PrConversationPanel(props: { task: Task }) {
  return (
    <Panel task={props.task}>
      {(context, model) => (
        <PrConversation model={model} onOpenFile={context.openFile} onLinkClick={context.onLinkClick} />
      )}
    </Panel>
  )
}

function PrFilesPanel(props: { task: Task }) {
  const context = usePr(props.task)
  const changedFiles = useChangedFiles(
    () => {
      const pull = context.tabs.selected()?.pull
      return pull ? { owner: pull.owner, repo: pull.repo, number: pull.number } : null
    },
    { router: false },
  )
  const select = (path: string) => {
    changedFiles.selectFile(path)
    const pull = context.tabs.selected()?.pull
    if (pull) requestFileScroll({ routeKey: routeKey(pull.owner, pull.repo, pull.number), path })
  }
  return (
    <Show when={context.model()} fallback={<EmptyState align="start" busy>Loading…</EmptyState>}>
      {(model) => (
        <PrFilesTab
          model={model()}
          current={changedFiles.currentFile}
          onSelect={select}
          header={<PullStrip tabs={context.tabs} />}
        />
      )}
    </Show>
  )
}

export const prPaneContribution: PaneLayoutContribution = {
  id: PANE_ID,
  label: 'PR review',
  glyph: 'git-pull-request',
  description: 'Overview, conversation & files',
  order: 10,
  defaultChord: 'meta+shift+r',
  when: (task) => task.pullNumber != null,
  minWidth: 520,
  layout: 'tabs',
  tabs: [
    { id: 'overview', label: 'Overview' },
    { id: 'conversation', label: 'Conversation' },
    { id: FILES_TAB, label: 'Files' },
  ],
  regions: {
    'panel:overview': PrOverviewPanel,
    'panel:conversation': PrConversationPanel,
    [`panel:${FILES_TAB}`]: PrFilesPanel,
  },
}
