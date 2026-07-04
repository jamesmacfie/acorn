import { createSignal, For, Match, Show, Switch } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsKey } from '../../../shared/api'
import { prefsOptions, workspacesOptions } from '../../queries'
import { setPref } from '../../mutations'
import { SHORTCUTS } from '../../Shortcuts'
import { PANE_SHORTCUT_DEFAULTS, paneKeys, RESERVED_KEYS, type PaneAction } from '../tasks/paneShortcuts'
import WorkspaceRepoAssignments from '../workspaces/WorkspaceRepoAssignments'
import IntegrationsSettings from '../integrations/IntegrationsSettings'
import WorkspaceSettings from './WorkspaceSettings'
import McpSettings from './McpSettings'
import WorkflowsSettings from './WorkflowsSettings'
import './settings.css'

// value → label. Must match the :root[data-theme="…"] blocks in tokens-layout.css.
const THEMES: [string, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['solarized-light', 'Solarized Light'],
  ['solarized-dark', 'Solarized Dark'],
  ['monokai', 'Monokai'],
  ['nord', 'Nord'],
  ['catppuccin-latte', 'Catppuccin Latte'],
  ['catppuccin-frappe', 'Catppuccin Frappé'],
  ['catppuccin-macchiato', 'Catppuccin Macchiato'],
  ['catppuccin-mocha', 'Catppuccin Mocha'],
  ['one-dark', 'One Dark'],
  ['dracula', 'Dracula'],
]

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
  // Default to following the OS until the user has explicitly picked a theme.
  const followSystem = () => (prefs.data?.theme_follow_system ?? (prefs.data?.theme ? 'false' : 'true')) === 'true'
  const theme = () => prefs.data?.theme ?? 'light'
  const lightTheme = () => prefs.data?.theme_light ?? 'light'
  const darkTheme = () => prefs.data?.theme_dark ?? 'dark'
  // Write the pref AND update the shared ['prefs'] cache so consumers (e.g. TerminalPanel) see it
  // without waiting for a refetch.
  const savePref = async (key: string, value: string) => {
    await setPref(key, value)
    qc.setQueryData<Record<string, string>>(prefsKey, (old) => ({ ...(old ?? {}), [key]: value }))
  }

  // Pane shortcut editing: capture the next key press on the focused row's input, reject reserved
  // keys and collisions, then persist a `pane_shortcuts` override diff (JSON Record<action, key>).
  const [shortcutErr, setShortcutErr] = createSignal('')
  const readOverrides = (): Record<string, string> => {
    try {
      return prefs.data?.pane_shortcuts ? (JSON.parse(prefs.data.pane_shortcuts) as Record<string, string>) : {}
    } catch {
      return {}
    }
  }
  const captureKey = (id: PaneAction, e: KeyboardEvent) => {
    e.preventDefault()
    const input = e.currentTarget as HTMLElement
    const k = e.key.toLowerCase()
    if (k === 'escape' || k === 'tab') return input.blur()
    if (k.length !== 1) return // ignore Shift, arrows, F-keys, …
    if (RESERVED_KEYS.has(k)) return setShortcutErr(`“${k}” is reserved by a global shortcut`)
    const keys = paneKeys(prefs.data?.pane_shortcuts)
    const clash = (Object.keys(keys) as PaneAction[]).find((a) => a !== id && keys[a] === k)
    if (clash) return setShortcutErr(`“${k}” is already used by ${PANE_SHORTCUT_DEFAULTS.find((s) => s.id === clash)?.label}`)
    setShortcutErr('')
    void savePref('pane_shortcuts', JSON.stringify({ ...readOverrides(), [id]: k }))
    input.blur()
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
          <button type="button" class="settings-nav-item" classList={{ active: tab() === 'appearance' }} onClick={() => setTab('appearance')}>
            Appearance
          </button>
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
            <Match when={tab() === 'appearance'}>
              <div class="overlay-title">Appearance</div>
              <label class="settings-field settings-field-row">
                <input
                  type="checkbox"
                  checked={followSystem()}
                  onChange={(e) => void savePref('theme_follow_system', e.currentTarget.checked ? 'true' : 'false')}
                />
                <span class="settings-label">Follow system light/dark setting</span>
              </label>
              <Show
                when={followSystem()}
                fallback={
                  <label class="settings-field">
                    <span class="settings-label">Theme</span>
                    <select
                      class="integration-key-input"
                      value={theme()}
                      onChange={(e) => void savePref('theme', e.currentTarget.value)}
                    >
                      <For each={THEMES}>{([value, label]) => <option value={value}>{label}</option>}</For>
                    </select>
                  </label>
                }
              >
                <label class="settings-field">
                  <span class="settings-label">Light theme</span>
                  <select
                    class="integration-key-input"
                    value={lightTheme()}
                    onChange={(e) => void savePref('theme_light', e.currentTarget.value)}
                  >
                    <For each={THEMES}>{([value, label]) => <option value={value}>{label}</option>}</For>
                  </select>
                </label>
                <label class="settings-field">
                  <span class="settings-label">Dark theme</span>
                  <select
                    class="integration-key-input"
                    value={darkTheme()}
                    onChange={(e) => void savePref('theme_dark', e.currentTarget.value)}
                  >
                    <For each={THEMES}>{([value, label]) => <option value={value}>{label}</option>}</For>
                  </select>
                </label>
              </Show>
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
              <div class="settings-section-label">Panes</div>
              <p class="muted">Click a key, then press the key you want. Active in the task view.</p>
              <Show when={shortcutErr()}><div class="action-error">{shortcutErr()}</div></Show>
              <dl class="help-list">
                <For each={PANE_SHORTCUT_DEFAULTS}>
                  {(s) => (
                    <>
                      <dt>
                        <input
                          type="text"
                          class="help-key shortcut-input"
                          readonly
                          value={paneKeys(prefs.data?.pane_shortcuts)[s.id]}
                          onKeyDown={(e) => captureKey(s.id, e)}
                          aria-label={`Shortcut for ${s.label}`}
                        />
                      </dt>
                      <dd class="help-desc">{s.label}</dd>
                    </>
                  )}
                </For>
              </dl>
              <div class="settings-actions">
                <button type="button" class="overlay-btn" onClick={() => { setShortcutErr(''); void savePref('pane_shortcuts', '{}') }}>
                  Reset panes to defaults
                </button>
              </div>
              <div class="settings-section-label">Global</div>
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
