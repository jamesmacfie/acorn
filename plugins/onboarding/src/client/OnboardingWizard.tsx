import { createMemo, createSignal, For, Index, lazy, Show, Suspense } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  canPickFolder,
  createProject,
  createWorkspace,
  nodeReady,
  patchProject,
  pickFolder,
  type Project,
  projectsKey,
  projectsOptions,
  workspacesKey,
  workspacesOptions,
} from '@acorn/plugin-api/client'
import { Acorn } from '@acorn/plugin-api/ui/host'
import { Alert, Badge, Button, Card, DescriptionList, Input, Kbd, Select } from '@acorn/plugin-api/ui'
import { saveOnboardingCompletion } from './onboardingCompletion'
import './wizard.css'

const GithubConnect = lazy(() => import('./GithubConnect'))

type Step = 'welcome' | 'add' | 'github' | 'organize' | 'done'

// Progress dots only count the screens a run passes through. `github` is a detour on the way to
// `organize`, so it shares that screen's position rather than adding a fifth dot.
const DOT_OF: Record<Step, number> = { welcome: 0, add: 1, github: 1, organize: 2, done: 3 }

/** Sentinel option: "put this project in a workspace that does not exist yet". */
const NEW_WORKSPACE = '__new__'

// Hardcoded rather than read from the keybinding registry. `onboarded` is a node preference, so this
// screen only ever renders for someone who has not rebound anything — and reaching the registry
// would pull registries/keybindings.ts onto the @acorn/plugin-api/client barrel, which a plugin's
// node-environment test suite has to be able to import.
const SHORTCUTS: [string, string][] = [
  ['⌘⇧N', 'new task'],
  ['⌘K', 'command palette'],
  ['⌘⇧T', 'terminal'],
  ['⌘P', 'find file'],
]

export default function OnboardingWizard(props: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const projects = createQuery(() => projectsOptions(nodeReady()))
  const workspaces = createQuery(() => workspacesOptions(nodeReady()))

  const [step, setStep] = createSignal<Step>('welcome')
  const [trail, setTrail] = createSignal<Step[]>([])
  // The ids of every project this run added, in the order they were added — reported by whatever did
  // the adding, never inferred. Importing is not a one-shot choice: an account has many repositories
  // and the natural move is to take three, so the wizard stays on the list until you say you are done
  // and then names the whole batch. An earlier version diffed the project list against a snapshot
  // taken on entry, which dropped any import that REPAIRED an existing project instead of creating
  // one — the batch then showed the last repository only.
  const [addedIds, setAddedIds] = createSignal<string[]>([])
  const [names, setNames] = createSignal<Record<string, string>>({})
  // Chosen workspace per project, empty until the owner picks one.
  const [homes, setHomes] = createSignal<Record<string, string>>({})
  // Which rows are naming a brand-new workspace, and what they have typed so far.
  const [drafts, setDrafts] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const added = createMemo(() => {
    const byId = new Map((projects.data ?? []).map((project) => [project.id, project]))
    return addedIds().map((id) => byId.get(id)).filter((project): project is Project => !!project)
  })

  const go = (next: Step) => {
    setTrail((seen) => [...seen, step()])
    setStep(next)
  }
  const back = () => {
    const seen = trail()
    if (!seen.length) return
    setStep(seen[seen.length - 1])
    setTrail(seen.slice(0, -1))
  }

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: projectsKey }),
    queryClient.invalidateQueries({ queryKey: workspacesKey }),
  ])

  // Both Finish and Skip land here. Skipping is not punished — it writes the same preference, so the
  // wizard does not ambush the user again on the next launch; everything it offered is in Settings.
  const finish = async () => {
    setBusy(true)
    try {
      await saveOnboardingCompletion(queryClient, props.onClose)
    } finally {
      setBusy(false)
    }
  }

  const remember = (ids: readonly string[]) => {
    setAddedIds((current) => [...current, ...ids.filter((id) => !current.includes(id))])
  }

  async function openFolder() {
    const path = await pickFolder()
    if (!path) return
    setBusy(true)
    setError('')
    try {
      const { project: created } = await createProject({ path })
      remember([created.id])
      await refresh()
      go('organize')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add that folder.')
    } finally {
      setBusy(false)
    }
  }

  // Called after EVERY successful import, and deliberately does not navigate: the owner decides when
  // the batch is finished.
  async function afterImport(ids: readonly string[] = []) {
    remember(ids)
    await refresh()
  }

  // A row can ask for a workspace that does not exist yet. Create it, point that project at it, and
  // let the refreshed list offer it to every other row — which is how a batch ends up spread across
  // several new workspaces.
  async function createHome(project: Project, name: string) {
    setBusy(true)
    setError('')
    try {
      const workspace = await createWorkspace(name)
      setHomes((current) => ({ ...current, [project.id]: workspace.id }))
      setDrafts((current) => {
        const next = { ...current }
        delete next[project.id]
        return next
      })
      await queryClient.invalidateQueries({ queryKey: workspacesKey })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create that workspace.')
    } finally {
      setBusy(false)
    }
  }

  async function saveNames() {
    setBusy(true)
    setError('')
    try {
      for (const current of added()) {
        const name = names()[current.id]?.trim()
        const home = homes()[current.id]
        const patch = {
          ...(name && name !== current.name ? { name } : {}),
          ...(home && home !== current.workspaceId ? { workspaceId: home } : {}),
        }
        if (Object.keys(patch).length) await patchProject(current.id, patch)
      }
      await refresh()
      go('done')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save those changes.')
    } finally {
      setBusy(false)
    }
  }

  return (
    // Deliberately not the shared Modal, and deliberately without createDismissable: this is a
    // full-screen takeover, and Escape or a stray backdrop click must not silently skip setup.
    <div class="wizard-backdrop">
      <div class="wizard" role="dialog" aria-modal="true" aria-label="Set up acorn">
        <div class="scroll">
          <Show when={step() === 'welcome'}>
            <div class="wizard-body">
              <Acorn />
              <h2>Welcome.</h2>
              <p class="wizard-lede">
                acorn is a workspace for running coding tasks — agents, terminals, editors — against your
                projects. Setup takes about a minute.
              </p>
              <Button variant="solid" tone="accent" onClick={() => go('add')}>Get started</Button>
            </div>
          </Show>

          <Show when={step() === 'add'}>
            <div class="wizard-body">
              <h2>Add your first project.</h2>
              <p class="wizard-lede">
                A project is just a folder on your machine. Git and GitHub are optional — features light
                up as they're detected.
              </p>
              <div class="wizard-cards">
                <Card class="wizard-card" interactive disabled={!canPickFolder() || busy()} onActivate={() => void openFolder()}>
                  <span class="wizard-card-title">Open a folder</span>
                  <span class="wizard-card-desc">Point acorn at any folder. Plain folders work fine.</span>
                  <span class="wizard-card-tag">recommended</span>
                </Card>
                <Card class="wizard-card" interactive onActivate={() => go('github')}>
                  <span class="wizard-card-title">Connect GitHub</span>
                  <span class="wizard-card-desc">Import repositories — clone them, or map ones you already have locally.</span>
                  <span class="wizard-card-tag">optional · anytime in settings</span>
                </Card>
              </div>
              <Show when={!canPickFolder()}>
                <p class="wizard-hint">Choosing a folder needs the desktop app.</p>
              </Show>
              <Show when={error()}><Alert>{error()}</Alert></Show>
              <p class="wizard-hint">
                Not sure? Open a folder. You can connect GitHub later and acorn will match it up
                automatically.
              </p>
            </div>
          </Show>

          <Show when={step() === 'github'}>
            <Suspense fallback={<div class="wizard-body"><p class="muted">Loading…</p></div>}>
              <GithubConnect
                onBack={back}
                onImported={(ids) => void afterImport(ids)}
                added={added()}
                onContinue={() => go('organize')}
              />
            </Suspense>
          </Show>

          <Show when={step() === 'organize'}>
            <div class="wizard-body">
              <h2>{added().length > 1 ? 'Name them your way.' : 'Name it your way.'}</h2>
              <p class="wizard-lede">
                Rename {added().length > 1 ? 'these projects' : 'the project'} and the workspace they live
                in. Names are yours — they don't touch the folder or the repo.
              </p>
              <Show when={added().length} fallback={<p class="muted">No project yet — you can add one from Settings whenever you like.</p>}>
                {/* Index, not For: these are editable inputs, and For keys by object identity, so a
                    refetch would destroy the row mid-typing along with the caret. */}
                <Index each={added()}>
                  {(current) => (
                    <div class="wizard-project">
                      <Input
                        width="auto"
                        aria-label={`Name of ${current().name}`}
                        value={names()[current().id] ?? current().name}
                        onInput={(event) => {
                          const value = event.currentTarget.value
                          setNames((all) => ({ ...all, [current().id]: value }))
                        }}
                      />
                      <span class="wizard-facets">
                        <Show when={current().path} fallback={<Badge>no folder yet</Badge>}><Badge tone="add">Folder</Badge></Show>
                        <Show when={current().vcs === 'git'}><Badge tone="add">Git</Badge></Show>
                        <Show when={current().github}><Badge tone="add">GitHub</Badge></Show>
                      </span>
                      <span class="wizard-path">
                        {current().path
                          ? current().vcs === 'git'
                            ? current().path
                            : `${current().path} · plain folder — git features light up if you add git later`
                          : 'no folder on disk yet — add one anytime from Settings'}
                      </span>
                      {/* Per project, not per batch. Adding four repositories at once is normal, and
                          they do not all belong together — so each picks its workspace, and each can
                          mint one the next row will find waiting in its list. */}
                      <span class="wizard-home">
                        <Show
                          when={drafts()[current().id] === undefined}
                          fallback={
                            <>
                              <Input
                                width="auto"
                                aria-label={`New workspace for ${current().name}`}
                                placeholder="Workspace name"
                                value={drafts()[current().id] ?? ''}
                                ref={(el: HTMLInputElement) => queueMicrotask(() => el.focus())}
                                onInput={(event) => {
                                  const value = event.currentTarget.value
                                  setDrafts((all) => ({ ...all, [current().id]: value }))
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter') return
                                  event.preventDefault()
                                  const value = drafts()[current().id]?.trim()
                                  if (value) void createHome(current(), value)
                                }}
                              />
                              <Button
                                size="sm"
                                busy={busy()}
                                disabled={!drafts()[current().id]?.trim()}
                                onClick={() => void createHome(current(), drafts()[current().id]!.trim())}
                              >
                                Create
                              </Button>
                            </>
                          }
                        >
                          <Select
                            width="auto"
                            aria-label={`Workspace for ${current().name}`}
                            onChange={(event) => {
                              const value = event.currentTarget.value
                              if (value === NEW_WORKSPACE) setDrafts((all) => ({ ...all, [current().id]: '' }))
                              else setHomes((all) => ({ ...all, [current().id]: value }))
                            }}
                          >
                            <For each={workspaces.data ?? []}>
                              {(workspace) => (
                                <option
                                  value={workspace.id}
                                  selected={workspace.id === (homes()[current().id] ?? current().workspaceId)}
                                >
                                  {workspace.name}
                                </option>
                              )}
                            </For>
                            <option value={NEW_WORKSPACE}>New workspace…</option>
                          </Select>
                        </Show>
                      </span>
                    </div>
                  )}
                </Index>
              </Show>
              <Show when={error()}><Alert>{error()}</Alert></Show>
              <Button variant="solid" tone="accent" busy={busy()} onClick={() => void saveNames()}>Continue</Button>
            </div>
          </Show>

          <Show when={step() === 'done'}>
            <div class="wizard-body">
              <h2>You're set.</h2>
              <p class="wizard-lede">Start a task whenever you're ready. A few keys worth knowing:</p>
              <DescriptionList class="wizard-keys" size="sm">
                <For each={SHORTCUTS}>
                  {([chord, label]) => <DescriptionList.Item label={<Kbd>{chord}</Kbd>}>{label}</DescriptionList.Item>}
                </For>
              </DescriptionList>
              <Button variant="solid" tone="accent" busy={busy()} onClick={() => void finish()}>Open acorn</Button>
            </div>
          </Show>
        </div>

        <div class="wizard-foot">
          <span class="wizard-dots" aria-hidden="true">
            <For each={[0, 1, 2, 3]}>{(index) => <i classList={{ on: index <= DOT_OF[step()] }} />}</For>
          </span>
          <Show when={trail().length}>
            <Button variant="bare" onClick={back}>← back</Button>
          </Show>
          <Show when={step() !== 'done'}>
            <Button variant="bare" busy={busy()} onClick={() => void finish()}>skip for now</Button>
          </Show>
        </div>
      </div>
    </div>
  )
}
