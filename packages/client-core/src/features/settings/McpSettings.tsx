import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { McpServerSummary } from '@acorn/protocol/mcp.ts'
import { projectsOptions, tasksOptions } from '../../infra/queries'
import type { SettingsPageContext } from '../../host/registries/shell/settings'
import { activeTaskId } from '../tasks/tasks'
import { mcpApi } from './mcpClient'
import { Button, Select } from '../../kit/components/primitives'
import { Link } from '../../kit/components/content/Link'
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
      else setCreateError(res.reason ?? 'Could not create.')
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
        description="The MCP servers your agents load by themselves, read from the project folder's .mcp.json and .cursor/mcp.json and from ~/.claude.json. acorn never starts these; the agent does, and nothing in acorn can switch one off. Secret values are masked."
        actions={<Button size="sm" onPress={() => void refetch()}>Rescan</Button>}
      >
        <Show when={props.context}>
          {(context) => (
            <p class="muted">
              The servers acorn adds to every session, whichever harness runs it, are on{' '}
              <Link onPress={() => context().navigate('agent-mcp-servers')}>MCP servers</Link>.
            </p>
          )}
        </Show>
        <SettingRow label="Project" description="Whose files to read. A task's worktree loads the same committed files.">
          <Select
            label="Project"
            value={projectId() ?? ''}
            disabled={!projects.data?.length}
            options={(projects.data ?? []).map((candidate) => ({ value: candidate.id, label: candidate.name }))}
            onChange={setPicked}
          />
        </SettingRow>
        <Show when={project() && !project()?.path}>
          <p class="muted">{project()?.name} has no folder on this node yet, so only ~/.claude.json is read.</p>
        </Show>
        <Show when={readError()}>{(message) => <p class="settings-error" role="alert">{message()}</p>}</Show>
        <Show when={(configs() ?? []).length} fallback={<Show when={!readError()}><p class="muted">No MCP config files found.</p></Show>}>
          <For each={configs() ?? []}>
            {(cfg) => (
              <SettingRow label={cfg.file} layout="stacked">
                <For each={cfg.servers}>
                  {(s: McpServerSummary) => (
                    <div class="mcp-server">
                      <span class="mcp-server-name">{s.name}</span>
                      <span class="mcp-server-transport muted">{s.transport}</span>
                      <span class="mcp-server-status" classList={{ 'mcp-invalid': s.status === 'invalid', 'mcp-disabled': s.status === 'disabled' }}>
                        {s.status}
                      </span>
                      <span class="mcp-server-cmd muted" title={s.command ?? s.url}>{s.command ?? s.url ?? ''}</span>
                      <Show when={s.env && Object.keys(s.env).length}>
                        <span class="mcp-server-env muted">env: {Object.entries(s.env ?? {}).map(([k, v]) => `${k}=${v}`).join(' ')}</span>
                      </Show>
                    </div>
                  )}
                </For>
                <Show when={!cfg.servers.length}>
                  <span class="muted">No servers declared.</span>
                </Show>
              </SettingRow>
            )}
          </For>
        </Show>
        <SettingRow
          label="Starter file"
          description="Adds an empty .mcp.json to the project's folder. Commit it, and a task on a new branch loads it too."
          error={createError() || undefined}
        >
          <Button size="sm" disabled={!project()?.path} onPress={() => void createStarter()}>Create .mcp.json</Button>
          <Show when={created()}><span class="muted">{created()}</span></Show>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        id="acorn-server"
        label="acorn MCP server"
        description="Exposes the current task (PR, linked issues, context) as tools to your agents. Auto-registered via each agent's own CLI (`claude mcp add` / `codex mcp add`) whenever a Claude Code / Codex terminal launches — no setup needed. To opt out, remove the `acorn` server with `claude mcp remove` / `codex mcp remove`."
      />
    </>
  )
}
