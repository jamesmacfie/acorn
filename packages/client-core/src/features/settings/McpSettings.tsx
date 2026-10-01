import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { McpServerSummary } from '@acorn/protocol/mcp.ts'
import { projectsOptions, tasksOptions } from '../../infra/queries'
import type { SettingsPageContext } from '../../host/registries/shell/settings'
import { activeTaskId } from '../tasks/tasks'
import { mcpApi } from './mcpClient'
import { Badge, Button, EmptyState, Select } from '../../kit/components/primitives'
import { Text } from '../../kit/components/content/Text'
import { Inline } from '../../kit/components/layout/Inline'
import { SectionHeader } from '../../kit/components/layout/SectionHeader'
import { formatPath } from '../../kit/lib/rendering/formatPath'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'

// Settings → Agents → MCP config files (docs/mcp.md § Configuration): a read-only inspector over the
// MCP config files the agents in one project load, from its folder's .mcp.json and .cursor/mcp.json and
// from ~/.claude.json. Secrets arrive already masked from the node.
//
// Keyed by a project picker rather than by the open task, so the page shows the same servers for a
// project whether or not a task is open. It starts on the open task's project when there is one. The
// servers acorn itself adds are on the agents plugin's MCP servers page, which this page links to,
// because acorn can add a server but cannot remove one a CLI loads by itself.
const STATUS = {
  enabled: { word: 'On', tone: 'ok' },
  disabled: { word: 'Off', tone: 'neutral' },
  invalid: { word: 'Invalid', tone: 'danger' },
} as const

// A command is often two absolute paths, which wrap over several lines in a row's description. Each
// path is cut to its last two folders, and the whole command waits behind the help mark.
const shortCommand = (command: string) => command.split(/\s+/).map((part) => (part.includes('/') || part.includes('\\') ? formatPath(part) : part)).join(' ')
const serverHelp = (s: McpServerSummary): string | undefined => {
  const lines = [
    s.command && shortCommand(s.command) !== s.command ? `Runs ${s.command}` : '',
    s.env && Object.keys(s.env).length ? `Environment: ${Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join(' ')}` : '',
  ].filter(Boolean)
  return lines.length ? lines.join('. ') : undefined
}

export default function McpSettings(props: { context?: SettingsPageContext }) {
  const projects = createQuery(() => projectsOptions(true))
  const tasks = createQuery(() => tasksOptions(true))
  // What the last Create did: the file it wrote, or why it wrote nothing.
  const [created, setCreated] = createSignal('')
  const [createError, setCreateError] = createSignal('')
  const [picked, setPicked] = createSignal<string>()

  const openTaskProject = () => {
    const taskId = activeTaskId()
    return taskId ? tasks.data?.find((task) => task.id === taskId)?.projectId ?? undefined : undefined
  }
  const projectId = createMemo(() => {
    const list = projects.data ?? []
    const chosen = picked() ?? openTaskProject()
    return (chosen && list.some((project) => project.id === chosen) ? chosen : list[0]?.id) ?? undefined
  })
  const project = () => projects.data?.find((candidate) => candidate.id === projectId())

  // A failed read is said and reads as no files, rather than thrown: a resource that failed throws
  // again wherever it is read, which would take the page down over one unreachable node.
  const [readError, setReadError] = createSignal('')
  const [configs, { refetch }] = createResource(projectId, async (id) => {
    setReadError('')
    try {
      return await mcpApi.inspect(id)
    } catch (failure) {
      setReadError(failure instanceof Error ? failure.message : String(failure))
      return []
    }
  }, { initialValue: [] })

  async function createStarter() {
    const id = projectId()
    setCreated('')
    setCreateError('')
    if (!id) return setCreateError('Add a project first.')
    try {
      const res = await mcpApi.createStarter(id)
      if (res.ok) setCreated(`Created .mcp.json in ${project()?.name ?? 'the project'}'s folder.`)
      else setCreateError(res.reason ?? "Couldn't create the file.")
    } catch (failure) {
      setCreateError(failure instanceof Error ? failure.message : String(failure))
    }
    await refetch()
  }

  return (
    <>
      <SettingsSection
        id="files"
        label="Config files"
        description="Servers your agents load from their own config files. acorn can't turn these off."
        help="acorn reads .mcp.json and .cursor/mcp.json in the project folder, and ~/.claude.json. Secret values are hidden."
        actions={
          <>
            <Show when={props.context}>
              {(context) => <Button size="sm" variant="ghost" onPress={() => context().navigate('agent-mcp-servers')}>MCP servers</Button>}
            </Show>
            <Button size="sm" onPress={() => void refetch()}>Rescan</Button>
          </>
        }
      >
        <SettingRow label="Project" help="Tasks on this project load the same files from their worktree.">
          <Select
            label="Project"
            value={projectId() ?? ''}
            disabled={!projects.data?.length}
            options={(projects.data ?? []).map((candidate) => ({ value: candidate.id, label: candidate.name }))}
            onChange={setPicked}
          />
        </SettingRow>
        <Show when={project() && !project()?.path}>
          <Text emphasis="muted" wrap>{project()?.name} has no folder here, so acorn reads only ~/.claude.json.</Text>
        </Show>
        <Show when={readError()}>{(message) => <p class="settings-error" role="alert">{message()}</p>}</Show>
        <Show when={(configs() ?? []).length} fallback={<Show when={!readError()}><EmptyState align="start" size="sm">No MCP config files found.</EmptyState></Show>}>
          <For each={configs() ?? []}>
            {(cfg) => (
              <>
                <SectionHeader level="sub"><Text tip={cfg.file}>{formatPath(cfg.file)}</Text></SectionHeader>
                <For each={cfg.servers} fallback={<EmptyState align="start" size="sm">No servers in this file.</EmptyState>}>
                  {(s: McpServerSummary) => (
                    <SettingRow
                      label={s.name}
                      description={s.command ? shortCommand(s.command) : s.url ?? undefined}
                      help={serverHelp(s)}
                    >
                      <Inline>
                        <Badge size="xs">{s.transport === 'unknown' ? 'Unknown' : s.transport}</Badge>
                        <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].word}</Badge>
                      </Inline>
                    </SettingRow>
                  )}
                </For>
              </>
            )}
          </For>
        </Show>
        <SettingRow
          label="Starter file"
          description="Adds an empty .mcp.json to the project folder. Commit it so new tasks load it too."
          error={createError() || undefined}
        >
          <Button size="sm" disabled={!project()?.path} onPress={() => void createStarter()}>Create .mcp.json</Button>
          <Show when={created()}><span class="muted">{created()}</span></Show>
        </SettingRow>
      </SettingsSection>
    </>
  )
}
