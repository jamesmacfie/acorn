import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { workspacesOptions } from '../infra/queries'
import { settingsContributions } from '../host/registries/shell/settings'
import { ContributionBoundary } from '../kit/components/ContributionBoundary'
import { createDismissable } from '../kit/lib/dismissable'
import { Dynamic } from 'solid-js/web'
import './settings.css'
import { Button } from '../kit/components/primitives'

export default function SettingsModal(props: { onClose: () => void; initialTab?: string }) {
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
  const dismiss = createDismissable({ onDismiss: () => props.onClose(), container: () => dialog })

  return (
    <div class="overlay-backdrop" onClick={dismiss.onBackdropClick}>
      <div
        ref={dialog}
        class="overlay settings"
        role="dialog"
        aria-modal="true"
        onKeyDown={dismiss.onKeyDown}
        onClick={dismiss.onContainerClick}
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
          <Button variant="bare" onPress={props.onClose} title="Close" label="Close">✕</Button>
          <Show when={activePage()}>
            {(page) => (
              <ContributionBoundary contributionId={`settings:${page().id}`}>
                <div class="overlay-title">{activeWorkspace()?.name ?? page().title ?? page().label}</div>
                <Dynamic
                  component={page().component}
                  context={{
                    workspace: activeWorkspace(),
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
