import { createResource, createSignal, For, Show } from 'solid-js'
import type { McpServerSummary } from '../../../shared/mcp'
import { activeTaskId } from '../tasks/tasks'

// Settings → MCP (docs/mcp.md): a read-only inspector over the MCP config files the agents in
// this task's worktree would load (plus ~/.claude.json). Secrets arrive already masked from main.
export default function McpSettings() {
  const api = () => window.acorn?.mcp ?? null
  const [msg, setMsg] = createSignal('')
  const taskId = () => activeTaskId()

  const [configs, { refetch }] = createResource(
    () => taskId() ?? 'no-task',
    async () => {
      const a = api()
      if (!a) return []
      return a.inspect(taskId() ?? '')
    },
    { initialValue: [] },
  )

  async function createStarter() {
    const a = api()
    const id = taskId()
    if (!a || !id) return setMsg('Open a task first.')
    const res = await a.createStarter(id)
    setMsg(res.ok ? 'Created .mcp.json in the worktree.' : (res.reason ?? 'Could not create.'))
    await refetch()
  }

  return (
    <div class="settings-section">
      <span class="muted settings-hint">
        Read-only view of the MCP servers your agents load (worktree .mcp.json / .cursor/mcp.json + ~/.claude.json). acorn never starts these — the agent does. Secret values are masked.
      </span>
      <Show when={(configs() ?? []).length} fallback={<p class="muted">No MCP config files found{taskId() ? '' : ' — open a task to scan its worktree'}.</p>}>
        <For each={configs() ?? []}>
          {(cfg) => (
            <div class="settings-field">
              <span class="settings-label mcp-file">{cfg.file}</span>
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
            </div>
          )}
        </For>
      </Show>
      <div class="settings-actions">
        <button type="button" class="overlay-btn" onClick={() => void createStarter()}>Create .mcp.json</button>
        <button type="button" class="overlay-btn" onClick={() => void refetch()}>Rescan</button>
        <Show when={msg()}><span class="muted">{msg()}</span></Show>
      </div>

      <div class="settings-field">
        <span class="settings-label">acorn MCP server</span>
        <span class="muted settings-hint">
          Exposes the current task (PR, linked issues, context) as tools to your agents. Auto-registered via each agent's own CLI (`claude mcp add` / `codex mcp add`) whenever a Claude Code / Codex terminal launches — no setup needed. To opt out, remove the `acorn` server with `claude mcp remove` / `codex mcp remove`.
        </span>
      </div>
    </div>
  )
}
