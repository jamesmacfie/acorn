import { createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { projectsKey, projectsOptions, tasksKey, tasksOptions, workspacesKey, workspacesOptions } from '../../infra/queries'
import { deleteWorkspace, renameWorkspace } from '../workspaces/workspaceMutations'
import { ProjectTable } from '../workspaces/ProjectTable'
import type { Workspace } from '@acorn/protocol/api.ts'
import { confirmWillEvent } from '../../host/registries/shell/willPhase'
import { clientEvents } from '../../host/registries/commands/clientEvents'
import {
  projectSettingsTarget, settingsDetailTabs, settingsPagesInOrder, settingsRegistry, type SettingsPageContext,
} from '../../host/registries/shell/settings'
import { ContributionBoundary } from '../../kit/components/content/ContributionBoundary'
import { PluginStrip } from './plugins/PluginStrip'
import { Button, EmptyState, Input } from '../../kit/components/primitives'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { Stack } from '../../kit/components/layout/Stack'
import { TabPanel, Tabs } from '../../kit/components/layout/Tabs'
import { createSettingSave, createTextSetting } from './settingSave'
import { WorkspaceConnections } from './ProjectConnections'

// Settings → a workspace's own page: its name, its projects, and deleting it. Each project's config is
// on the project's page, one click from the table (./ProjectSettings.tsx), because it describes one
// codebase rather than the group (docs/workspaces-and-tasks.md § Worktrees and setup).
//
// Which provider projects a workspace follows is in its Connections section: the same map each
// connection's page draws, from this workspace's side (./ProjectConnections.tsx). One project's own
// links are on its Connections tab.
//
// The Default workspace is where a deleted workspace's projects land, so it can be neither renamed nor
// deleted, here or anywhere else in settings.
//
// A settings page a plugin registers with `scope: 'workspace'` is a tab beside General, drawn with this
// workspace in its context. With none, the page has no tab strip.

const ID_PREFIX = 'workspace-settings'
const pluginTab = (pageId: string) => `plugin-${pageId}`

export default function WorkspaceSettings(props: { workspace: Workspace; context: SettingsPageContext }) {
  const plugins = createMemo(() => settingsDetailTabs(settingsPagesInOrder(), 'workspace'))
  const [tab, setTab] = createSignal('general')
  const tabs = () => [{ id: 'general', label: 'General' }, ...plugins().map((page) => ({ id: pluginTab(page.id), label: page.label }))]
  const active = () => (tabs().some((entry) => entry.id === tab()) ? tab() : 'general')
  const panel = (id: string, children: () => JSX.Element) => (
    <TabPanel idPrefix={ID_PREFIX} id={id} active={active()}>
      <Stack gap="section">{children()}</Stack>
    </TabPanel>
  )
  return (
    <Show when={plugins().length} fallback={<Stack gap="section"><General workspace={props.workspace} context={props.context} /></Stack>}>
      <Tabs tabs={tabs()} active={active()} onChange={setTab} idPrefix={ID_PREFIX} ariaLabel={`Settings for ${props.workspace.name}`} />
      {panel('general', () => <General workspace={props.workspace} context={props.context} />)}
      <For each={plugins()}>
        {(page) => panel(pluginTab(page.id), () => (
          <>
            {/* A plugin's tab gets the same strip as its page would, above and outside its content. */}
            <Show when={settingsRegistry.ownerOf(page.id)}>
              {(owner) => <PluginStrip pluginId={owner()} railSources={page.railSourceVisibility} navigate={props.context.navigate} />}
            </Show>
            <div class="settings-plugin-content">
              <ContributionBoundary contributionId={`settings:${page.id}`} owner={settingsRegistry.ownerOf(page.id)}>
                <Dynamic component={page.component} context={props.context} />
              </ContributionBoundary>
            </div>
          </>
        ))}
      </For>
    </Show>
  )
}

function General(props: { workspace: Workspace; context: SettingsPageContext }) {
  const qc = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const tasks = createQuery(() => tasksOptions(true))
  const members = () => (projects.data ?? []).filter((project) => project.workspaceId === props.workspace.id)
  const [busy, setBusy] = createSignal(false)
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: workspacesKey }),
    qc.invalidateQueries({ queryKey: projectsKey }),
    qc.invalidateQueries({ queryKey: tasksKey }),
  ])

  // The page's workspace comes from the workspaces query, so awaiting its refetch is what lets the
  // field show the stored name again. A blank name is refused here, as the route would refuse it.
  const name = createTextSetting({
    value: () => props.workspace.name,
    save: async (value) => {
      if (props.workspace.isDefault) throw new Error("The Default workspace can't be renamed.")
      const trimmed = value.trim()
      if (!trimmed) throw new Error('A workspace needs a name.')
      if (trimmed === props.workspace.name) return
      await renameWorkspace(props.workspace.id, trimmed)
      await qc.invalidateQueries({ queryKey: workspacesKey })
    },
  })

  const removal = createSettingSave()
  const remove = async () => {
    if (props.workspace.isDefault) return
    const { confirmed } = await confirmWillEvent({
      kind: 'workspace:remove',
      payload: { workspaceId: props.workspace.id, name: props.workspace.name },
      title: 'Delete workspace',
      actionLabel: 'Delete workspace',
      alwaysConfirm: true,
      // What the node's delete route does: projects move to Default, and only the workspace row and
      // its tracker-project links are removed.
      stays: 'Its projects and their tasks move back to Default. Nothing on disk is removed.',
      concerns: [{ id: `workspace:${props.workspace.id}`, feature: 'Workspaces', message: 'The workspace and its links to tracker projects are deleted.', severity: 'danger' }],
    })
    if (!confirmed) return
    setBusy(true)
    try {
      if (!(await removal.run(() => deleteWorkspace(props.workspace.id)))) return
      props.context.onWorkspaceDeleted()
      await refresh()
      clientEvents.emit('runtime:workspace-removed', { workspaceId: props.workspace.id })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsSection id="general" label="General">
        <SettingRow
          label="Name"
          description={props.workspace.isDefault ? "The Default workspace can't be renamed." : undefined}
          savedAt={name.savedAt()}
          error={name.error()}
        >
          <Input
            label="Name"
            value={name.value()}
            disabled={props.workspace.isDefault}
            onInput={name.input}
            onChange={(value) => void name.commit(value)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection id="projects" label="Projects" help="Open a project to set its scripts, preview, database, and connections.">
        <Show when={members().length} fallback={projects.data ? <EmptyState align="start" size="sm">This workspace has no projects. Move one here from Overview.</EmptyState> : undefined}>
          <ProjectTable
            groups={[{ id: props.workspace.id, label: props.workspace.name, workspaceId: props.workspace.id, projects: members() }]}
            workspaces={workspaces.data ?? []}
            taskCount={(projectId) => (tasks.data ?? []).filter((task) => task.projectId === projectId).length}
            groupHeads={false}
            openProject={(id) => props.context.navigate(projectSettingsTarget(id))}
            refresh={refresh}
          />
        </Show>
      </SettingsSection>

      <WorkspaceConnections workspace={props.workspace} navigate={props.context.navigate} />

      <Show when={!props.workspace.isDefault}>
        <SettingsSection id="danger" label="Danger zone" tone="danger">
          <SettingRow label="Delete workspace" description="Its projects move back to Default." error={removal.error()}>
            <Button tone="danger" disabled={busy()} onPress={() => void remove()}>
              Delete workspace
            </Button>
          </SettingRow>
        </SettingsSection>
      </Show>
    </>
  )
}
