import { createSignal, For, Match, Switch } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { workspacesOptions } from '../../queries'
import WorkspaceRepoAssignments from '../workspaces/WorkspaceRepoAssignments'
import IntegrationsSettings from '../integrations/IntegrationsSettings'
import WorkspaceSettings from './WorkspaceSettings'
import McpSettings from './McpSettings'
import WorkflowsSettings from './WorkflowsSettings'
import AppearanceSettings from './AppearanceSettings'
import TerminalSettings from './TerminalSettings'
import ShortcutsSettings from './ShortcutsSettings'
import PermissionsSettings from './PermissionsSettings'
import './settings.css'

// The Settings page (profile dropdown → Settings). Left tab rail + right pane. `tab` is either a
// fixed key or a workspace id. PURE tab chrome — every tab body is its own component under
// features/settings (or the feature that owns it), this file just routes between them.
export default function SettingsModal(props: { onClose: () => void; initialTab?: string; onPermissions: () => void | Promise<void> }) {
  const workspaces = createQuery(() => workspacesOptions(true))
  const [tab, setTab] = createSignal(props.initialTab ?? 'workspaces')
  const activeWorkspace = () => workspaces.data?.find((w) => w.id === tab())

  const TABS: [string, string][] = [
    ['appearance', 'Appearance'],
    ['integrations', 'Integrations'],
    ['mcp', 'MCP'],
    ['workflows', 'Workflows'],
    ['terminal', 'Terminal'],
    ['shortcuts', 'Shortcuts'],
    ['permissions', 'Permissions'],
  ]

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
          <For each={TABS}>
            {([id, label]) => (
              <button type="button" class="settings-nav-item" classList={{ active: tab() === id }} onClick={() => setTab(id)}>
                {label}
              </button>
            )}
          </For>
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
            <Match when={tab() === 'appearance'}>
              <div class="overlay-title">Appearance</div>
              <AppearanceSettings />
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
              <TerminalSettings />
            </Match>
            <Match when={tab() === 'shortcuts'}>
              <div class="overlay-title">Keyboard shortcuts</div>
              <ShortcutsSettings />
            </Match>
            <Match when={tab() === 'permissions'}>
              <div class="overlay-title">Permissions</div>
              <PermissionsSettings onPermissions={props.onPermissions} />
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  )
}
