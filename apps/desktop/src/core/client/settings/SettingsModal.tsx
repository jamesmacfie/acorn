import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { workspacesOptions } from '../queries'
import { settingsContributions } from '../registries/settings'
import { ContributionBoundary } from '../ui/ContributionBoundary'
import { trapOverlayFocus } from '../ui/focus'
import { Dynamic } from 'solid-js/web'
import './settings.css'

export default function SettingsModal(props: { onClose: () => void; initialTab?: string; onPermissions: () => void | Promise<void> }) {
  const workspaces = createQuery(() => workspacesOptions(true))
  const [tab, setTab] = createSignal(props.initialTab ?? 'workspaces')
  const generalPages = () => settingsContributions().filter((page) => page.group === 'general')
  const workspacePage = () => settingsContributions().find((page) => page.group === 'workspace')
  const activeWorkspace = () => workspaces.data?.find((workspace) => workspace.id === tab())
  const activePage = createMemo(() => {
    if (activeWorkspace()) return workspacePage()
    return generalPages().find((page) => page.id === tab()) ?? generalPages()[0]
  })
  let dialog!: HTMLDivElement

  return (
    <div class="overlay-backdrop" onClick={props.onClose}>
      <div
        ref={dialog}
        class="overlay settings"
        role="dialog"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key === 'Escape') props.onClose()
          else trapOverlayFocus(event, dialog)
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <nav class="settings-nav">
          <Show when={generalPages().find((page) => page.id === 'workspaces')}>
            {(page) => (
              <button type="button" class="settings-nav-item" classList={{ active: tab() === page().id }} onClick={() => setTab(page().id)}>
                {page().label}
              </button>
            )}
          </Show>
          <Show when={workspacePage()}>
            <div class="settings-nav-group">Workspaces</div>
            <For each={workspaces.data ?? []}>
              {(workspace) => (
                <button type="button" class="settings-nav-item settings-nav-sub" classList={{ active: tab() === workspace.id }} onClick={() => setTab(workspace.id)}>
                  {workspace.name}
                </button>
              )}
            </For>
          </Show>
          <div class="settings-nav-group">General</div>
          <For each={generalPages().filter((page) => page.id !== 'workspaces')}>
            {(page) => (
              <button type="button" class="settings-nav-item" classList={{ active: tab() === page.id }} onClick={() => setTab(page.id)}>
                {page.label}
              </button>
            )}
          </For>
        </nav>

        <div class="settings-pane">
          <button type="button" class="settings-close" onClick={props.onClose} title="Close" aria-label="Close">✕</button>
          <Show when={activePage()}>
            {(page) => (
              <ContributionBoundary contributionId={`settings:${page().id}`}>
                <div class="overlay-title">{activeWorkspace()?.name ?? page().title ?? page().label}</div>
                <Dynamic
                  component={page().component}
                  context={{
                    workspace: activeWorkspace(),
                    onPermissions: props.onPermissions,
                    onWorkspaceDeleted: () => setTab('workspaces'),
                  }}
                />
              </ContributionBoundary>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
