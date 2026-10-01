import { createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { Project } from '@acorn/protocol/api.ts'
import { projectsKey, tasksKey, tasksOptions, workspacesKey, workspacesOptions } from '../../infra/queries'
import { canPickFolder, pickFolder } from '../../infra/platform'
import { deleteProject, patchProject } from '../workspaces/workspaceMutations'
import { ProjectColorInput } from '../workspaces/ProjectColorInput'
import {
  settingsDetailTabs, settingsPagesInOrder, settingsRegistry, workspaceSettingsTarget, type SettingsPageContext,
} from '../../host/registries/shell/settings'
import { confirmAction } from '../../host/registries/shell/willPhase'
import { ContributionBoundary } from '../../kit/components/content/ContributionBoundary'
import { PluginStrip } from './plugins/PluginStrip'
import { Text } from '../../kit/components/content/Text'
import { Button, Checkbox, EmptyState, Input, Select } from '../../kit/components/primitives'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { Stack } from '../../kit/components/layout/Stack'
import { TabPanel, Tabs } from '../../kit/components/layout/Tabs'
import { BranchPrefixRow, createProjectConfig, DatabaseTab, PreviewTab, SetupTab, type ProjectConfigStore } from './ProjectConfigTabs'
import { ProjectConnections } from './ProjectConnections'
import { createSettingSave, createTextSetting } from './settingSave'

// Settings → a project's own page (docs/frontend.md § Settings). One folder project's identity and its
// project-level config, split over tabs because together they are two dozen rows. A settings page a
// plugin registers with `scope: 'project'` is one more tab, drawn with this project in its context.
//
// Every tab's panel stays mounted while hidden (the kit's TabPanel), which keeps a half-typed field
// across a tab switch and is what lets a deep link to a section on another tab find it.

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'setup', label: 'Setup and scripts' },
  { id: 'web-preview', label: 'Preview' },
  { id: 'sql', label: 'Database' },
  { id: 'connections', label: 'Connections' },
] as const

const ID_PREFIX = 'project-settings'
const pluginTab = (pageId: string) => `plugin-${pageId}`

export default function ProjectSettings(props: { project: Project; context: SettingsPageContext }) {
  const store = createProjectConfig(() => props.project.id)
  const plugins = createMemo(() => settingsDetailTabs(settingsPagesInOrder(), 'project'))
  const tabs = () => [
    ...TABS,
    ...plugins().map((page) => ({ id: pluginTab(page.id), label: page.label })),
  ]
  const [tab, setTab] = createSignal('general')
  // A plugin that goes away takes its tab, and the page shows General rather than nothing.
  const active = () => (tabs().some((entry) => entry.id === tab()) ? tab() : 'general')

  const panel = (id: string, children: () => JSX.Element) => (
    <TabPanel idPrefix={ID_PREFIX} id={id} active={active()}>
      <Stack gap="section">{children()}</Stack>
    </TabPanel>
  )
  // The config tabs wait for the first read, because the page-rules editor takes its list once.
  const loaded = (children: () => JSX.Element) => (
    <Show
      when={store.response()}
      fallback={store.failed()
        ? <Text tone="danger" wrap>Couldn't load this project's settings.</Text>
        : <EmptyState busy align="start" size="sm">Loading…</EmptyState>}
    >
      {children()}
    </Show>
  )

  return (
    <>
      <Tabs tabs={tabs()} active={active()} onChange={setTab} idPrefix={ID_PREFIX} ariaLabel={`Settings for ${props.project.name}`} />
      {panel('general', () => <GeneralTab project={props.project} store={store} context={props.context} />)}
      {panel('setup', () => loaded(() => <SetupTab store={store} />))}
      {panel('web-preview', () => loaded(() => <PreviewTab store={store} />))}
      {panel('sql', () => loaded(() => <DatabaseTab store={store} />))}
      {panel('connections', () => <ProjectConnections project={props.project} navigate={props.context.navigate} />)}
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
    </>
  )
}

// Name, folder, colour, workspace, visibility and branch prefix, then the danger zone. These are the
// project row's own columns, written through the project route, where every other tab writes the
// project's config.
function GeneralTab(props: { project: Project; store: ProjectConfigStore; context: SettingsPageContext }) {
  const qc = useQueryClient()
  const workspaces = createQuery(() => workspacesOptions(true))
  const tasks = createQuery(() => tasksOptions(true))
  const taskCount = () => (tasks.data ?? []).filter((task) => task.projectId === props.project.id).length
  // The page's project comes from the projects query, so awaiting its refetch is what lets a field show
  // the stored value again.
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: projectsKey }),
    qc.invalidateQueries({ queryKey: workspacesKey }),
  ])
  const patch = async (change: Parameters<typeof patchProject>[1]) => {
    await patchProject(props.project.id, change)
    await refresh()
  }

  const name = createTextSetting({
    value: () => props.project.name,
    save: async (value) => {
      const trimmed = value.trim()
      if (!trimmed) throw new Error('A project needs a name.')
      if (trimmed !== props.project.name) await patch({ name: trimmed })
    },
  })
  const folder = createSettingSave()
  const colour = createSettingSave()
  const workspace = createSettingSave()
  const visibility = createSettingSave()
  const removal = createSettingSave()
  const [busy, setBusy] = createSignal(false)

  const changeFolder = async () => {
    const path = await pickFolder()
    if (path) await folder.run(() => patch({ path }))
  }

  const remove = async () => {
    const count = taskCount()
    const confirmed = await confirmAction({
      title: 'Delete project',
      actionLabel: count ? `Delete project and ${count} task${count === 1 ? '' : 's'}` : 'Delete project',
      goes: count
        ? `${props.project.name} is removed from acorn, with its ${count} task${count === 1 ? '' : 's'} and their history.`
        : `${props.project.name} is removed from acorn.`,
      stays: `Nothing on disk is removed. The folder${count ? ' and any task worktrees remain where they are' : ' remains where it is'}.`,
      danger: true,
    })
    if (!confirmed) return
    setBusy(true)
    try {
      if (!(await removal.run(() => deleteProject(props.project.id)))) return
      // Off the page before the lists refetch, so the view does not fall back to its first page and
      // say this one is no longer available.
      props.context.navigate(workspaceSettingsTarget(props.project.workspaceId))
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: tasksKey })])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsSection id="general" label="General">
        <SettingRow label="Name" savedAt={name.savedAt()} error={name.error()}>
          <Input label="Name" maxLength={120} value={name.value()} onInput={name.input} onChange={(value) => void name.commit(value)} />
        </SettingRow>
        <SettingRow
          label="Folder"
          description={props.project.path ? undefined : 'No folder on disk. Add one to use this project for tasks.'}
          layout="stacked"
          error={folder.error()}
        >
          <Show when={props.project.path}>{(path) => <Text emphasis="mono" wrap>{path()}</Text>}</Show>
          <Show when={canPickFolder()}>
            <div>
              <Button onPress={() => void changeFolder()}>{props.project.path ? 'Change folder…' : 'Add folder…'}</Button>
            </div>
          </Show>
        </SettingRow>
        <SettingRow label="Rail colour" help="The coloured strip beside this project's tasks in the rail." error={colour.error()}>
          <ProjectColorInput
            name={props.project.name}
            color={props.project.color}
            onChange={(color) => colour.run(() => patch({ color }))}
          />
        </SettingRow>
        <SettingRow label="Workspace" error={workspace.error()}>
          <Select
            label="Workspace"
            value={props.project.workspaceId}
            options={(workspaces.data ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
            onChange={(workspaceId) => void workspace.run(() => patch({ workspaceId }))}
          />
        </SettingRow>
        <SettingRow
          label="Hidden"
          description="Its tasks don't show in the rail, and new tasks can't use it."
          error={visibility.error()}
        >
          <Checkbox
            switch
            ariaLabel="Hidden"
            checked={props.project.hidden}
            onChange={(hidden) => visibility.run(() => patch({ hidden }))}
          />
        </SettingRow>
        <BranchPrefixRow store={props.store} />
      </SettingsSection>

      <SettingsSection id="danger" label="Danger zone" tone="danger">
        <SettingRow label="Delete project" description="Its tasks go with it. Nothing on disk is removed." error={removal.error()}>
          <Button tone="danger" disabled={busy()} onPress={() => void remove()}>Delete project</Button>
        </SettingRow>
      </SettingsSection>
    </>
  )
}
