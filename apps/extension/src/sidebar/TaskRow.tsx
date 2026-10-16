import { Show, type JSX } from 'solid-js'
import type { BridgePageTask } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import { Row } from '@acorn/client-core/kit/components/primitives.tsx'
import { agentRailMarkers } from '@acorn/plugin-agents/contract/runtimeState.ts'
import type { BrowserApi, Tab } from '../browser'
import type { AgentCounts } from '../taskPages'
import { showPage, tabFor } from './openTabs'

// A task as a row, the kit's stacked row with the desktop's agent mark. Home's task list, a project
// site's tasks, and This page draw their tasks with these.

// A task's agents as the desktop marks them: an amber alert while one waits on the person, which wins
// over the spinner while one works, and an idle dot otherwise.
function AgentMark(props: { agents: AgentCounts }) {
  const marker = () => agentRailMarkers({ working: props.agents.working, attention: props.agents.waiting })[0]
  return (
    <Show when={marker()} fallback={<span class="idle-dot" aria-hidden="true" />}>
      {(shown) => <Icon name={shown().icon!} tone={shown().tone} spin={shown().busy} title={shown().label} />}
    </Show>
  )
}

// A task in a list of a project's tasks: its branch and whether its agents need the person, then
// whether it's the page beside the panel, or a button to the tab that shows one of its pages.
export function TaskRow(props: {
  api: BrowserApi
  tabs: readonly Tab[]
  task: BridgePageTask
  here: boolean
  agents: AgentCounts
  openTask(taskId: string): void
}) {
  const tabPage = () => (props.here ? undefined : props.task.pages.find((page) => tabFor(props.tabs, page)))
  return (
    <li>
      <Row
        variant="stacked"
        onPress={() => props.openTask(props.task.id)}
        leading={<AgentMark agents={props.agents} />}
        trailing={
          <Show
            when={props.here}
            fallback={
              <Show when={tabPage()}>
                {(page) => (
                  <IconButton
                    icon="arrow-right-left"
                    label="Switch to its tab"
                    onPress={() => void showPage(props.api, props.tabs, page())}
                  />
                )}
              </Show>
            }
          >
            <span class="here">This page</span>
          </Show>
        }
      >
        <span class="row-title">{props.task.title}</span>
        <span class="row-meta">
          <Show when={props.task.branch} fallback="Project checkout">
            {(branch) => <span class="branch">{branch()}</span>}
          </Show>
          <Show when={props.agents.waiting} fallback={props.agents.working ? ' · working' : ''}>
            {' · '}
            <span class="needs-you">needs you</span>
          </Show>
        </span>
      </Row>
    </li>
  )
}

// The task the page beside the panel belongs to: its title over its project and branch, and a chevron.
// `state` is what a plugin says of an app it published for the task, such as a running stack.
export function PageTaskRow(props: {
  title: string
  project: string
  branch: string | null
  agents: AgentCounts
  state?: JSX.Element
  onPress(): void
}) {
  return (
    <li>
      <Row
        variant="stacked"
        onPress={() => props.onPress()}
        leading={<AgentMark agents={props.agents} />}
        trailing={
          <>
            {props.state}
            <Icon name="chevron-right" tone="muted" />
          </>
        }
      >
        <strong class="row-title">{props.title}</strong>
        <span class="row-meta">
          {props.project}
          <Show when={props.branch}>
            {(branch) => (
              <>
                {' · '}
                <span class="branch">{branch()}</span>
              </>
            )}
          </Show>
        </span>
      </Row>
    </li>
  )
}
