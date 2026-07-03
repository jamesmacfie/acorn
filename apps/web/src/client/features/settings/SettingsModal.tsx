import { createSignal, For, Match, Show, Switch } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsKey } from '../../../shared/api'
import { prefsOptions, workspacesOptions } from '../../queries'
import { setPref } from '../../mutations'
import { SHORTCUTS } from '../../Shortcuts'
import WorkspaceRepoAssignments from '../workspaces/WorkspaceRepoAssignments'
import IntegrationsSettings from '../integrations/IntegrationsSettings'
import WorkspaceSettings from './WorkspaceSettings'
import McpSettings from './McpSettings'
import WorkflowsSettings from './WorkflowsSettings'
import './settings.css'

// The Settings page (profile dropdown → Settings). Left tab rail + right pane. Tabs: the
// repo→workspace mapping, one page per workspace, plus Integrations / Shortcuts / Permissions
// (folded out of the account menu). `tab` is either a fixed key or a workspace id.
export default function SettingsModal(props: { onClose: () => void; initialTab?: string; onPermissions: () => void | Promise<void> }) {
  const qc = useQueryClient()
  const workspaces = createQuery(() => workspacesOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const [tab, setTab] = createSignal(props.initialTab ?? 'workspaces')
  const activeWorkspace = () => workspaces.data?.find((w) => w.id === tab())
  const railDefault = () => prefs.data?.term_rail_default ?? 'empty'
  // Write the pref AND update the shared ['prefs'] cache so consumers (e.g. TerminalPanel) see it
  // without waiting for a refetch.
  const savePref = async (key: string, value: string) => {
    await setPref(key, value)
    qc.setQueryData<Record<string, string>>(prefsKey, (old) => ({ ...(old ?? {}), [key]: value }))
  }

  return (
    <div class="overlay-backdrop" onClick={props.onClose}>
      <div class="overlay settings" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <nav class="settings-nav">
          <button type="button" class="settings-nav-item" classList={{ active: tab() === 'workspaces' }} onClick={() => setTab('workspaces')}>
            Workspaces
          </button>
          <div class="settings-nav-group">Workspaces</div>
          <For each={workspaces.data ?? []}>
            {(w) => (
              <button type="button" class="settings-nav-item settings-nav-sub" classList={{ active: tab() === w.id }} onClick={() => setTab(w.id)}>
                {w.name}
              </button>
            )}
          </For>
          <div class="settings-nav-group">General</div>
          <button type="button" class="settings-nav-item" classList={{ active: tab() === 'integrations' }} onClick={() => setTab('integrations')}>
            Integrations
          </button>
          <button type="button" class="settings-nav-item" classList={{ active: tab() === 'mcp' }} onClick={() => setTab('mcp')}>
            MCP
          </button>
          <button type="button" class="settings-nav-item" classList={{ active: tab() === 'workflows' }} onClick={() => setTab('workflows')}>
            Workflows
          </button>
          <button type="button" class="settings-nav-item" classList={{ active: tab() === 'terminal' }} onClick={() => setTab('terminal')}>
            Terminal
          </button>
          <button type="button" class="settings-nav-item" classList={{ active: tab() === 'shortcuts' }} onClick={() => setTab('shortcuts')}>
            Shortcuts
          </button>
          <button type="button" class="settings-nav-item" classList={{ active: tab() === 'permissions' }} onClick={() => setTab('permissions')}>
            Permissions
          </button>
        </nav>

        <div class="settings-pane">
          <button type="button" class="settings-close" onClick={props.onClose} title="Close" aria-label="Close">
            ✕
          </button>
          <Switch fallback={<WorkspaceRepoAssignments />}>
            <Match when={tab() === 'workspaces'}>
              <div class="overlay-title">Workspaces</div>
              <WorkspaceRepoAssignments />
            </Match>
            <Match when={activeWorkspace()} keyed>
              {(w) => (
                <>
                  <div class="overlay-title">{w.name}</div>
                  <WorkspaceSettings workspace={w} onDeleted={() => setTab('workspaces')} />
                </>
              )}
            </Match>
            <Match when={tab() === 'integrations'}>
              <div class="overlay-title">Integrations</div>
              <IntegrationsSettings />
            </Match>
            <Match when={tab() === 'mcp'}>
              <div class="overlay-title">MCP</div>
              <McpSettings />
            </Match>
            <Match when={tab() === 'workflows'}>
              <div class="overlay-title">Workflows</div>
              <WorkflowsSettings />
            </Match>
            <Match when={tab() === 'terminal'}>
              <div class="overlay-title">Terminal</div>
              <label class="settings-field">
                <span class="settings-label">When the terminal button is clicked, open</span>
                <select
                  class="integration-key-input"
                  value={railDefault()}
                  onChange={(e) => void savePref('term_rail_default', e.currentTarget.value)}
                >
                  <option value="empty">Empty (pick a profile with +)</option>
                  <option value="shell">Shell</option>
                  <option value="claude-code">Claude Code</option>
                  <option value="codex">Codex</option>
                </select>
              </label>
            </Match>
            <Match when={tab() === 'shortcuts'}>
              <div class="overlay-title">Keyboard shortcuts</div>
              <dl class="help-list">
                <For each={SHORTCUTS}>
                  {([key, desc]) => (
                    <>
                      <dt class="help-key">{key}</dt>
                      <dd class="help-desc">{desc}</dd>
                    </>
                  )}
                </For>
              </dl>
            </Match>
            <Match when={tab() === 'permissions'}>
              <div class="overlay-title">Permissions</div>
              <p class="muted">Re-request GitHub access (e.g. after adding organizations or private repos). This reloads acorn.</p>
              <div class="settings-actions">
                <button type="button" class="overlay-btn" onClick={() => void props.onPermissions()}>
                  Re-request GitHub permissions
                </button>
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  )
}
