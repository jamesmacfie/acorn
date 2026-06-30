import { createEffect, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { assignmentsOptions, prefsKey, reposOptions, workspaceAssignmentsKey, workspacesKey, workspacesOptions } from '../../queries'
import { createWorkspace, ignoreRepo, setAllReposIgnored, setPref, setRepoWorkspace, unignoreRepo } from '../../mutations'
import { terminalApi } from '../terminal/terminalClient'
import './onboarding.css'

// First-run workspace setup (docs/workspaces). The bootstrap already put every repo in a Default
// workspace; here the user re-groups them into named workspaces and (on desktop) points each repo
// at its on-disk checkout via the native folder picker. The eye toggle hides a repo from the app
// (it keeps its workspace membership, just greyed + excluded everywhere). Changes apply immediately;
// "Done" records the onboarded pref so the modal doesn't reappear.
export default function OnboardingModal(props: { onClose: () => void }) {
  const qc = useQueryClient()
  const repos = createQuery(() => reposOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const assignments = createQuery(() => assignmentsOptions(true))
  const api = terminalApi()

  const assignFor = (key: string) => assignments.data?.find((a) => `${a.owner}/${a.name}` === key)
  const isIgnored = (key: string) => assignFor(key)?.ignored ?? false
  const wsForRepo = (key: string) => assignFor(key)?.workspaceId ?? ''
  // Master toggle state: all hidden ⇒ the toggle offers "show all", otherwise "hide all".
  const allHidden = () => {
    const list = repos.data ?? []
    return list.length > 0 && list.every((r) => isIgnored(`${r.owner}/${r.name}`))
  }
  const [paths, setPaths] = createSignal<Record<string, string>>({}) // "owner/name" → on-disk path
  const [newName, setNewName] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: workspacesKey }), qc.invalidateQueries({ queryKey: workspaceAssignmentsKey })])

  // Load existing checkout paths once (desktop only), so already-mapped repos show their folder.
  let loaded = false
  createEffect(() => {
    const list = repos.data
    if (loaded || !api || !list) return
    loaded = true
    void Promise.all(
      list.map(async (r) => {
        const rp = await api.repoPath.get(r.owner, r.name)
        if (rp) setPaths((p) => ({ ...p, [`${r.owner}/${r.name}`]: rp.path }))
      }),
    )
  })

  async function assign(owner: string, name: string, wsId: string) {
    await setRepoWorkspace(wsId, owner, name)
    await refresh()
  }
  async function toggleHide(owner: string, name: string, key: string) {
    if (isIgnored(key)) await unignoreRepo(owner, name)
    else await ignoreRepo(owner, name)
    await refresh()
  }
  async function toggleAll() {
    await setAllReposIgnored(!allHidden())
    await refresh()
  }
  async function browse(owner: string, name: string) {
    if (!api) return
    const picked = await api.repoPath.pick()
    if (!picked) return
    const res = await api.repoPath.set(owner, name, picked)
    if (!res.ok) return window.alert(res.reason)
    setPaths((p) => ({ ...p, [`${owner}/${name}`]: res.repoPath.path }))
  }
  async function addWorkspace(e: Event) {
    e.preventDefault()
    const n = newName().trim()
    if (!n) return
    setBusy(true)
    try {
      await createWorkspace(n)
      await qc.invalidateQueries({ queryKey: workspacesKey })
      setNewName('')
    } finally {
      setBusy(false)
    }
  }
  async function done() {
    await setPref('onboarded', '1')
    await qc.invalidateQueries({ queryKey: prefsKey })
    props.onClose()
  }

  return (
    <div class="overlay-backdrop">
      <div class="overlay onboarding" role="dialog" aria-modal="true">
        <div class="overlay-title">Set up your workspaces</div>
        <div class="overlay-body">
          <p class="muted">
            A workspace is a named group of repositories. Assign each repo to a workspace
            {api ? ', and optionally point it at where the code lives on disk.' : '.'} Hide a repo with the eye toggle.
          </p>

          <form class="integration-key-row onboarding-newrow" onSubmit={addWorkspace}>
            <input
              class="integration-key-input"
              type="text"
              placeholder="New workspace name (e.g. Runn)"
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
            />
            <button type="submit" class="overlay-btn" disabled={busy() || !newName().trim()}>
              Add workspace
            </button>
          </form>

          <div class="onboarding-listhead">
            <button
              type="button"
              class="onboarding-eye"
              classList={{ hidden: allHidden() }}
              title={allHidden() ? 'Show all repos' : 'Hide all repos'}
              aria-pressed={allHidden()}
              onClick={() => void toggleAll()}
            >
              {allHidden() ? '⊘' : '◉'}
            </button>
            <span class="muted">Repositories</span>
          </div>

          <div class="onboarding-list">
            <For each={repos.data ?? []}>
              {(r) => {
                const key = `${r.owner}/${r.name}`
                const hidden = () => isIgnored(key)
                return (
                  <div class="onboarding-row" classList={{ 'onboarding-ignored': hidden() }}>
                    <button
                      type="button"
                      class="onboarding-eye"
                      classList={{ hidden: hidden() }}
                      title={hidden() ? 'Hidden — click to show' : 'Hide this repo'}
                      aria-pressed={hidden()}
                      onClick={() => void toggleHide(r.owner, r.name, key)}
                    >
                      {hidden() ? '⊘' : '◉'}
                    </button>
                    <span class="onboarding-repo" title={key}>
                      {r.owner}/{r.name}
                    </span>
                    {/* Per-option `selected` (not select `value`): TanStack returns fresh objects on
                        refetch, so the option <For> recreates nodes and a `value` binding would drop
                        the selection. `selected` is reapplied as each option node is created. */}
                    <select class="integration-key-input" disabled={hidden()} onChange={(e) => void assign(r.owner, r.name, e.currentTarget.value)}>
                      <For each={workspaces.data ?? []}>{(w) => <option value={w.id} selected={w.id === wsForRepo(key)}>{w.name}</option>}</For>
                    </select>
                    <Show when={api} fallback={<span />}>
                      <button type="button" class="overlay-btn onboarding-browse" disabled={hidden()} title={paths()[key] ?? 'Choose folder'} onClick={() => void browse(r.owner, r.name)}>
                        {paths()[key] ? '✓ Folder' : 'Browse…'}
                      </button>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
        <div class="onboarding-footer">
          <button type="button" class="overlay-btn" onClick={() => void done()}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
