import { createMemo, createSignal, Index, lazy, Show, Suspense } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  canPickFolder,
  createProject,
  createWorkspace,
  nodeReady,
  patchProject,
  pickFolder,
  type Project,
  projectsOptions,
  workspacesKey,
  workspacesOptions,
} from '@acorn/plugin-api/client'
import { Acorn, Wizard } from '@acorn/plugin-api/ui/host'
import {
  Alert, Badge, Button, Card, Field, Heading, Inline, Input, Kbd, Modal, Select, Stack, Text,
  Toolbar,
} from '@acorn/plugin-api/ui'

import { saveOnboardingCompletion } from './onboardingCompletion'

const GithubConnect = lazy(() => import('./GithubConnect'))
const AiSetup = lazy(() => import('./AiSetup'))

type Step = 'welcome' | 'add' | 'github' | 'organize' | 'ai' | 'done'

// The steps the host draws in its indicator. `github` is a detour on the way to `organize`, so it
// shares `add`'s place in the strip rather than taking an entry of its own, which is what the
// hand-drawn dot strip's `DOT_OF` map used to say.
export const STEPS = [
  { id: 'add', label: 'Add a project' },
  { id: 'organize', label: 'Name it' },
  { id: 'ai', label: 'Generate with AI' },
  { id: 'done', label: 'Ready' },
] as const

/**
 * Whether the host draws an enabled **Next** on a step.
 *
 * Exported so the check can see it. The rule is "a step whose only way forward is doing something on
 * it says so", which is true of adding a project and of nothing else: the AI step offers a CLI it
 * found and a key form, and someone who wants neither must still be able to leave.
 */
export const canAdvanceOn = (step: Step, addedCount: number): boolean =>
  step === 'add' || step === 'github' ? addedCount > 0 : true

const place = (step: Step): string => (step === 'github' ? 'add' : step)

/** Sentinel option: "put this project in a workspace that does not exist yet". */
const NEW_WORKSPACE = '__new__'

// Hardcoded rather than read from the keybinding registry. `onboarded` is a node preference, so
// this screen only ever renders for someone who has not rebound anything, and reaching the
// registry would pull registries/keybindings.ts onto the @acorn/plugin-api/client barrel, which a
// plugin's node-environment test suite has to be able to import.
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
  // The ids of every project this run added, in the order they were added, reported by whatever did
  // the adding, never inferred. Importing is not a one-shot choice: an account has many repositories
  // and the natural move is to take three, so the wizard stays on the list until you say you are
  // done and then names the whole batch. An earlier version diffed the project list against a
  // snapshot taken on entry, which dropped any import that repaired an existing project instead of
  // creating one: the batch then showed the last repository only.
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

  // Projects refetch on the node's `project:changed` frame now; workspaces still have no event.
  const refresh = () => queryClient.invalidateQueries({ queryKey: workspacesKey })

  // Both Finish and Skip land here. Skipping writes the same preference as finishing, so the wizard
  // does not ambush the user again on the next launch. Everything it offered is in Settings.
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

  // Runs after every successful import and does not navigate on its own: the owner decides when
  // the batch is finished.
  async function afterImport(ids: readonly string[] = []) {
    remember(ids)
    await refresh()
  }

  // A row can ask for a workspace that does not exist yet. Create it, point that project at it, and
  // let the refreshed list offer it to every other row. That is how a batch ends up spread across
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
      go('ai')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save those changes.')
    } finally {
      setBusy(false)
    }
  }

  // The host's Back and Next hand back the id of the step they landed on. Back is this wizard's own
  // trail rather than the strip's previous entry, because `github` shares a place with `add` and the
  // strip cannot tell which of the two you came from. Forward off `organize` is the save.
  const onStep = (id: string) => {
    const order = STEPS.map((entry) => entry.id) as string[]
    if (order.indexOf(id) < order.indexOf(place(step()))) return back()
    if (step() === 'organize') return void saveNames()
    go(id as Step)
  }
  const canAdvance = () => canAdvanceOn(step(), added().length)

  const StepBody = () => (
    <Stack gap="section">
      <Show when={step() === 'welcome'}>
        <Stack gap="row">
          <Acorn />
          <Heading level={2}>Welcome.</Heading>
          <Text emphasis="muted" wrap>
            acorn is a workspace for running coding tasks — agents, terminals, editors — against your
            projects. Setup takes about a minute.
          </Text>
          <Toolbar variant="actions" size="sm">
            <Button variant="solid" tone="accent" onPress={() => go('add')}>Get started</Button>
          </Toolbar>
        </Stack>
      </Show>

      <Show when={step() === 'add'}>
        <Stack gap="row">
          <Heading level={2}>Add your first project.</Heading>
          <Text emphasis="muted" wrap>
            A project is just a folder on your machine. Git and GitHub are optional — features light
            up as they're detected.
          </Text>
          <Inline gap="stack" wrap>
            <Card interactive disabled={!canPickFolder() || busy()} onPress={() => void openFolder()}>
              <Stack gap="row">
                <Text emphasis="strong">Open a folder</Text>
                <Text emphasis="muted" wrap>Point acorn at any folder. Plain folders work fine.</Text>
                <Text emphasis="eyebrow">recommended</Text>
              </Stack>
            </Card>
            <Card interactive onPress={() => go('github')}>
              <Stack gap="row">
                <Text emphasis="strong">Connect GitHub</Text>
                <Text emphasis="muted" wrap>Import repositories — clone them, or map ones you already have locally.</Text>
                <Text emphasis="eyebrow">optional · anytime in settings</Text>
              </Stack>
            </Card>
          </Inline>
          <Show when={!canPickFolder()}>
            <Text emphasis="muted">Choosing a folder needs the desktop app.</Text>
          </Show>
          <Show when={error()}>{(text) => <Alert>{text()}</Alert>}</Show>
          <Text emphasis="muted" wrap>
            Not sure? Open a folder. You can connect GitHub later and acorn will match it up
            automatically.
          </Text>
        </Stack>
      </Show>

      <Show when={step() === 'github'}>
        <Suspense fallback={<Text emphasis="muted">Loading…</Text>}>
          <GithubConnect
            onBack={back}
            onImported={(ids) => void afterImport(ids)}
            added={added()}
            onContinue={() => go('organize')}
          />
        </Suspense>
      </Show>

      <Show when={step() === 'organize'}>
        <Stack gap="row">
          <Heading level={2}>{added().length > 1 ? 'Name them your way.' : 'Name it your way.'}</Heading>
          <Text emphasis="muted" wrap>
            Rename {added().length > 1 ? 'these projects' : 'the project'} and the workspace they live
            in. Names are yours — they don't touch the folder or the repo.
          </Text>
          <Show when={added().length} fallback={<Text emphasis="muted">No project yet — you can add one from Settings whenever you like.</Text>}>
            {/* Index, not For: these are editable inputs, and For keys by object identity, so a
                refetch would destroy the row mid-typing along with the caret. */}
            <Index each={added()}>
              {(current) => (
                <Card>
                  <Stack gap="row">
                    <Inline gap="stack" wrap>
                      <Field label="Name">
                        <Input
                          width="auto"
                          value={names()[current().id] ?? current().name}
                          onInput={(value) => setNames((all) => ({ ...all, [current().id]: value }))}
                        />
                      </Field>
                      <Inline gap="inline" wrap>
                        <Show when={current().path} fallback={<Badge>no folder yet</Badge>}><Badge tone="ok">Folder</Badge></Show>
                        <Show when={current().vcs === 'git'}><Badge tone="ok">Git</Badge></Show>
                        <Show when={current().github}><Badge tone="ok">GitHub</Badge></Show>
                      </Inline>
                    </Inline>
                    <Text emphasis="muted" wrap>
                      {current().path
                        ? current().vcs === 'git'
                          ? current().path
                          : `${current().path} · plain folder — git features light up if you add git later`
                        : 'no folder on disk yet — add one anytime from Settings'}
                    </Text>
                    {/* Per project, not per batch. Adding four repositories at once is normal, and
                        they do not all belong together — so each picks its workspace, and each can
                        mint one the next row will find waiting in its list. */}
                    <Show
                      when={drafts()[current().id] === undefined}
                      fallback={
                        <Inline gap="inline" wrap>
                          <Field label="New workspace">
                            <Input
                              width="auto"
                              placeholder="Workspace name"
                              value={drafts()[current().id] ?? ''}
                              ref={(el: HTMLInputElement) => queueMicrotask(() => el.focus())}
                              onInput={(value) => setDrafts((all) => ({ ...all, [current().id]: value }))}
                              onSubmit={(value) => {
                                if (value.trim()) void createHome(current(), value.trim())
                              }}
                            />
                          </Field>
                          <Button
                            size="sm"
                            busy={busy()}
                            disabled={!drafts()[current().id]?.trim()}
                            onPress={() => void createHome(current(), drafts()[current().id]!.trim())}
                          >
                            Create
                          </Button>
                        </Inline>
                      }
                    >
                      <Field label="Workspace">
                        <Select
                          width="auto"
                          value={homes()[current().id] ?? current().workspaceId}
                          options={[
                            ...(workspaces.data ?? []).map((workspace) => ({ value: workspace.id, label: workspace.name })),
                            { value: NEW_WORKSPACE, label: 'New workspace…' },
                          ]}
                          onChange={(value) => {
                            if (value === NEW_WORKSPACE) setDrafts((all) => ({ ...all, [current().id]: '' }))
                            else setHomes((all) => ({ ...all, [current().id]: value }))
                          }}
                        />
                      </Field>
                    </Show>
                  </Stack>
                </Card>
              )}
            </Index>
          </Show>
          <Show when={error()}>{(text) => <Alert>{text()}</Alert>}</Show>
          <Toolbar variant="actions" size="sm">
            <Button variant="solid" tone="accent" busy={busy()} onPress={() => void saveNames()}>Continue</Button>
          </Toolbar>
        </Stack>
      </Show>

      <Show when={step() === 'ai'}>
        {/* Lazy for the same reason the GitHub screen is: it opens two queries of its own, and a run
            that skips out before this step never pays for them. */}
        <Suspense fallback={<Text emphasis="muted">Loading…</Text>}>
          <Stack gap="row">
            <AiSetup />
            <Toolbar variant="actions" size="sm">
              <Button variant="solid" tone="accent" onPress={() => go('done')}>Continue</Button>
            </Toolbar>
          </Stack>
        </Suspense>
      </Show>

      <Show when={step() === 'done'}>
        <Stack gap="row">
          <Heading level={2}>You're set.</Heading>
          <Text emphasis="muted" wrap>Start a task whenever you're ready. A few keys worth knowing:</Text>
          {/* The chord is the label and the words are the value, so the key caps line up in one
              column the way a shortcut sheet does. */}
          <Stack gap="row">
            <Index each={SHORTCUTS}>
              {(entry) => (
                <Inline gap="inline">
                  <Kbd>{entry()[0]}</Kbd>
                  <Text emphasis="muted">{entry()[1]}</Text>
                </Inline>
              )}
            </Index>
          </Stack>
          <Toolbar variant="actions" size="sm">
            <Button variant="solid" tone="accent" busy={busy()} onPress={() => void finish()}>Open acorn</Button>
          </Toolbar>
        </Stack>
      </Show>
    </Stack>
  )

  // `dismissOn={[]}`: a full-run setup must not vanish on a stray Escape or a backdrop click. The
  // custom full-screen backdrop this used to draw is gone, and so is the hand-rolled dot strip — the
  // `wizard` layout draws the step indicator and the back and next controls (docs/panes.md § Layout
  // model). What is left for the plugin is the step body and "skip for now".
  return (
    <Modal onDismiss={() => {}} dismissOn={[]} size="wide" title="Set up acorn">
      <Wizard
        stateKey="onboarding"
        label="Set up acorn"
        steps={STEPS}
        current={place(step())}
        onStep={onStep}
        canAdvance={canAdvance()}
        regions={{ step: () => <StepBody /> }}
      />
      <Toolbar variant="actions" size="sm">
        <Show when={step() !== 'done'}>
          <Button variant="bare" busy={busy()} onPress={() => void finish()}>skip for now</Button>
        </Show>
      </Toolbar>
    </Modal>
  )
}
