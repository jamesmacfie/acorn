import { createMemo, createSignal, Index, lazy, Show, Suspense } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  canPickFolder,
  createProject,
  createWorkspace,
  integrationsOptions,
  nodeReady,
  patchProject,
  pickFolder,
  type Project,
  projectPath,
  projectsOptions,
  workspacesKey,
  workspacesOptions,
} from '@acorn/plugin-api/client'
import { Acorn, Wizard } from '@acorn/plugin-api/ui/host'
import {
  Alert, Badge, Button, Card, DescriptionList, Field, Heading, Inline, Input, Kbd, Modal, Select, Stack, Text,
} from '@acorn/plugin-api/ui'

import { AddedTally } from './AddedTally'
import { saveOnboardingCompletion } from './onboardingCompletion'

const GithubConnect = lazy(() => import('./GithubConnect'))
const AiSetup = lazy(() => import('./AiSetup'))

type Step = 'welcome' | 'add' | 'github' | 'organize' | 'ai' | 'done'

// The steps the host draws in its indicator. `github` is a detour on the way to `organize`, so it
// shares `add`'s place in the strip rather than taking an entry of its own, which is what the
// hand-drawn dot strip's `DOT_OF` map used to say. `welcome` has a place of its own, so the host
// draws Next on it and Back on the step after it, which is the GitHub detour's way out.
export const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'add', label: 'Add a project' },
  { id: 'organize', label: 'Name' },
  { id: 'ai', label: 'Generate with AI' },
  { id: 'done', label: 'Ready' },
] as const

/**
 * Whether the host draws an enabled **Next** on a step.
 *
 * Exported so the check can see it. The rule is "a step whose only way forward is doing something on
 * it says so", which is true of adding a project and of nothing else: the AI step offers a CLI it
 * found and a key form, and someone who wants neither must still be able to leave. The naming step
 * also holds while a name is blank, because saving would quietly keep the old name.
 */
export const canAdvanceOn = (step: Step, addedCount: number, blankNames = 0): boolean => {
  if (step === 'add' || step === 'github') return addedCount > 0
  if (step === 'organize') return blankNames === 0
  return true
}

const place = (step: Step): string => (step === 'github' ? 'add' : step)

/** Sentinel option: "put this project in a workspace that does not exist yet". */
const NEW_WORKSPACE = '__new__'

// Hardcoded rather than read from the keybinding registry. `onboarded` is a node preference, so
// this screen only ever renders for someone who has not rebound anything, and reaching the
// registry would pull registries/keybindings.ts onto the @acorn/plugin-api/client barrel, which a
// plugin's node-environment test suite has to be able to import.
const SHORTCUTS: [string, string][] = [
  ['⌘⇧N', 'New task'],
  ['⌘K', 'Command palette'],
  ['⌘⇧T', 'Open a terminal'],
  ['⌘P', 'Find a file'],
]

export default function OnboardingWizard(props: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const projects = createQuery(() => projectsOptions(nodeReady()))
  const workspaces = createQuery(() => workspacesOptions(nodeReady()))
  const integrations = createQuery(() => integrationsOptions(nodeReady()))

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
  const nameOf = (project: Project): string => names()[project.id] ?? project.name
  const blankNames = () => added().filter((project) => !nameOf(project).trim()).length

  // GitHub is offered only when this node can start a sign-in, or already holds one. A build without
  // a GitHub client id reports the provider as not connectable, and the card used to lead to an
  // error the reader could do nothing about.
  const githubOffered = () => {
    const data = integrations.data
    return !!data && (
      data.providers.some((provider) => provider.id === 'github' && provider.connection.connectable) ||
      data.integrations.some((entry) => entry.providerId === 'github')
    )
  }

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

  // Finish and Skip both save the same preference, so the wizard does not ambush the user again on
  // the next launch. Everything it offered is in Settings. Finish also opens the first project it
  // added, so the first screen of the app shows the setup that was just done. Skip leaves the window
  // where it was.
  const close = async (landOn?: string) => {
    setBusy(true)
    try {
      if (await saveOnboardingCompletion(queryClient, props.onClose) && landOn) navigate(landOn)
    } finally {
      setBusy(false)
    }
  }
  const finish = () => close(added()[0] ? projectPath(added()[0].id) : undefined)
  const skip = () => close()

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

  const dropDraft = (project: Project) =>
    setDrafts((current) => {
      const next = { ...current }
      delete next[project.id]
      return next
    })

  // A row can ask for a workspace that does not exist yet. Create it, point that project at it, and
  // let the refreshed list offer it to every other row. That is how a batch ends up spread across
  // several new workspaces.
  async function createHome(project: Project, name: string) {
    setBusy(true)
    setError('')
    try {
      const workspace = await createWorkspace(name)
      setHomes((current) => ({ ...current, [project.id]: workspace.id }))
      dropDraft(project)
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
  const canAdvance = () => canAdvanceOn(step(), added().length, blankNames())

  // What the host's Next says on each step. A blocked step says what would unblock it.
  const nextLabel = (): string => {
    switch (step()) {
      case 'welcome': return 'Get started'
      case 'add': return canAdvance() ? 'Continue' : 'Add a project to continue'
      case 'github': return canAdvance() ? 'Done adding' : 'Add a repository to continue'
      default: return 'Continue'
    }
  }

  const StepBody = () => (
    <Stack gap="section">
      <Show when={step() === 'welcome'}>
        <Stack gap="row">
          <Acorn />
          <Heading level={2}>Welcome to acorn</Heading>
          <Text emphasis="muted" wrap>
            acorn is where you run coding tasks on your projects, with agents, terminals, and editors side
            by side. Setup takes about a minute.
          </Text>
        </Stack>
      </Show>

      <Show when={step() === 'add'}>
        <Stack gap="row">
          <Heading
            level={2}
            help={githubOffered()
              ? 'Not sure? Open a folder. If you connect GitHub later, acorn links it to the folders you already added.'
              : undefined}
          >
            {added().length ? 'Add another project' : 'Add your first project'}
          </Heading>
          <Text emphasis="muted" wrap>
            A project is a folder on your computer. It doesn't need Git or GitHub, but acorn uses them
            when they're there.
          </Text>
          <AddedTally added={added()} />
          <Inline gap="stack" even>
            <Card interactive disabled={!canPickFolder() || busy()} onPress={() => void openFolder()}>
              <Stack gap="row">
                <Show when={githubOffered()}><Text emphasis="eyebrow">Recommended</Text></Show>
                <Text emphasis="strong">Open a folder</Text>
                <Text emphasis="muted" wrap>Choose a folder on this computer.</Text>
              </Stack>
            </Card>
            <Show when={githubOffered()}>
              <Card interactive onPress={() => go('github')}>
                <Stack gap="row">
                  <Text emphasis="eyebrow">Optional</Text>
                  <Text emphasis="strong">Connect GitHub</Text>
                  <Text emphasis="muted" wrap>Clone your repositories, or link ones you already have on this computer.</Text>
                </Stack>
              </Card>
            </Show>
          </Inline>
          <Show when={!canPickFolder()}>
            <Text emphasis="muted">To choose a folder, use the desktop app.</Text>
          </Show>
          <Show when={error()}>{(text) => <Alert>{text()}</Alert>}</Show>
        </Stack>
      </Show>

      <Show when={step() === 'github'}>
        <Suspense fallback={<Text emphasis="muted">Loading…</Text>}>
          <GithubConnect
            onBack={back}
            onImported={(ids) => void afterImport(ids)}
            added={added()}
          />
        </Suspense>
      </Show>

      <Show when={step() === 'organize'}>
        <Stack gap="row">
          <Heading
            level={2}
            help="A workspace is a group of projects. The switcher at the top of the window shows one workspace at a time."
          >
            {added().length > 1 ? 'Name your projects' : 'Name your project'}
          </Heading>
          <Text emphasis="muted" wrap>Renaming a project doesn't change its folder.</Text>
          <Show when={added().length} fallback={<Text emphasis="muted">No project yet. You can add one later in Settings.</Text>}>
            {/* Index, not For: these are editable inputs, and For keys by object identity, so a
                refetch would destroy the row mid-typing along with the caret. */}
            <Index each={added()}>
              {(current) => (
                <Card>
                  <Stack gap="row">
                    {/* The folder is what tells two cards apart, so it is the card's title. */}
                    <Inline gap="inline" wrap>
                      <Show when={current().path} fallback={<Badge tone="warn">No folder</Badge>}>
                        {(path) => <Text emphasis="strong" wrap>{path()}</Text>}
                      </Show>
                      <Show when={current().vcs === 'git'}><Badge>Git</Badge></Show>
                      <Show when={current().github}><Badge>GitHub</Badge></Show>
                    </Inline>
                    <Show when={!current().path}>
                      <Text emphasis="muted" wrap>No folder yet. You can add one later in Settings.</Text>
                    </Show>
                    <Inline gap="stack" even>
                      <Field
                        label="Project name"
                        error={nameOf(current()).trim() ? undefined : 'A project needs a name.'}
                      >
                        <Input
                          value={nameOf(current())}
                          onInput={(value) => setNames((all) => ({ ...all, [current().id]: value }))}
                        />
                      </Field>
                      {/* Per project, not per batch. Adding four repositories at once is normal, and
                          they do not all belong together, so each picks its workspace, and each can
                          make one the next row will find waiting in its list. */}
                      <Show
                        when={drafts()[current().id] === undefined}
                        fallback={
                          <Stack gap="row">
                            <Field label="New workspace">
                              <Input
                                placeholder="Workspace name"
                                value={drafts()[current().id] ?? ''}
                                ref={(el: HTMLInputElement) => queueMicrotask(() => el.focus())}
                                onInput={(value) => setDrafts((all) => ({ ...all, [current().id]: value }))}
                                onSubmit={(value) => {
                                  if (value.trim()) void createHome(current(), value.trim())
                                }}
                              />
                            </Field>
                            <Inline gap="row">
                              <Button
                                busy={busy()}
                                disabled={!drafts()[current().id]?.trim()}
                                onPress={() => void createHome(current(), drafts()[current().id]!.trim())}
                              >
                                Create
                              </Button>
                              <Button variant="ghost" onPress={() => dropDraft(current())}>Cancel</Button>
                            </Inline>
                          </Stack>
                        }
                      >
                        <Field label="Workspace">
                          <Select
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
                    </Inline>
                  </Stack>
                </Card>
              )}
            </Index>
          </Show>
          <Show when={error()}>{(text) => <Alert>{text()}</Alert>}</Show>
        </Stack>
      </Show>

      <Show when={step() === 'ai'}>
        {/* Lazy for the same reason the GitHub screen is: it opens two queries of its own, and a run
            that skips out before this step never pays for them. */}
        <Suspense fallback={<Text emphasis="muted">Loading…</Text>}>
          <AiSetup />
        </Suspense>
      </Show>

      <Show when={step() === 'done'}>
        <Stack gap="row">
          <Heading level={2}>You're set</Heading>
          <Text emphasis="muted" wrap>Start a task whenever you like. These keys help you get around:</Text>
          {/* The chord is the label and the words are the value, so the key caps line up in one
              column the way a shortcut sheet does. */}
          <DescriptionList layout="columns">
            <Index each={SHORTCUTS}>
              {(entry) => (
                <DescriptionList.Item label={<Kbd>{entry()[0]}</Kbd>}>{entry()[1]}</DescriptionList.Item>
              )}
            </Index>
          </DescriptionList>
        </Stack>
      </Show>
    </Stack>
  )

  // `dismissOn={[]}`: a full-run setup must not vanish on a stray Escape or a backdrop click. The
  // custom full-screen backdrop this used to draw is gone, and so is the hand-rolled dot strip — the
  // `wizard` layout draws the step indicator and every action in its footer, including skip and the
  // last step's finish (docs/panes.md § Layout model). What is left for the plugin is the step body.
  // Busy blocks Next and finish, so a slow save cannot be pressed twice.
  return (
    <Modal onDismiss={() => {}} dismissOn={[]} size="lg" title="Set up acorn">
      <Wizard
        stateKey="onboarding"
        label="Set up acorn"
        steps={STEPS}
        current={place(step())}
        onStep={onStep}
        canAdvance={canAdvance() && !busy()}
        nextLabel={nextLabel()}
        finishLabel="Open acorn"
        onFinish={() => void finish()}
        skipLabel="Skip setup"
        skipTip="You can do all of this later in Settings."
        onSkip={() => void skip()}
        regions={{ step: () => <StepBody /> }}
      />
    </Modal>
  )
}
