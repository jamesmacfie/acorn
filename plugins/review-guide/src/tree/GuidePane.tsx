import { createEffect, createSignal, Match, on, onCleanup, Show, Switch } from 'solid-js'
import {
  Alert,
  Button,
  EmptyState,
  Inline,
  Link,
  Select,
  Stack,
  Text,
  Toolbar,
  ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { CHANGED_CHANNEL, type Guide, type GuideView, type ProgressMark, type StoredGuide } from '../shared/guide'
import { GuidePath, plural, type Reveal } from './GuidePath'

const API = '/v1/p/review-guide/guide'

const message = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.'

/** What the coverage and note checks changed, as sentences. Empty when the harness placed every hunk
 *  once and every note on its line. */
function coverageNotes(guide: Guide): string[] {
  return [
    ...(guide.uncovered.length
      ? [`${plural(guide.uncovered.length, "hunk wasn't", "hunks weren't")} covered by the guide. They're last.`]
      : []),
    ...(guide.repeated
      ? [`The guide put ${plural(guide.repeated, 'hunk', 'hunks')} in more than one step. Each is shown in its first.`]
      : []),
    ...(guide.unknown ? [`The guide named ${plural(guide.unknown, 'hunk', 'hunks')} that aren't in the change.`] : []),
    ...(guide.misplacedNotes
      ? [
          `Dropped ${plural(guide.misplacedNotes, 'note', 'notes')} that didn't match a line of the change or went past the limit.`,
        ]
      : []),
  ]
}

/** The Guide pane draws it `wide`, and the column beside the change request's diff draws it `narrow`.
 *  The host mounts it with the task. */
export function GuidePane(props: { taskId?: string; bridge: AcornBridge; layout: 'wide' | 'narrow' }) {
  const [view, setView] = createSignal<GuideView | null>(null)
  const [picked, setPicked] = createSignal<string | null>(null)
  const [failure, setFailure] = createSignal('')
  const [sending, setSending] = createSignal(false)

  const load = async () => {
    const taskId = props.taskId
    if (!taskId) return
    try {
      const next = await props.bridge.api.get<GuideView>(`${API}?taskId=${encodeURIComponent(taskId)}`)
      if (taskId !== props.taskId) return
      setView(next)
      setFailure('')
    } catch (error) {
      if (taskId === props.taskId) setFailure(message(error))
    }
  }
  createEffect(
    on(
      () => props.taskId,
      () => void load(),
    ),
  )
  onCleanup(props.bridge.events.on(CHANGED_CHANNEL, () => void load()))

  const profileId = () => picked() ?? view()?.profileId ?? null
  const profileLabel = (id: string) => view()?.profiles.find((profile) => profile.id === id)?.label ?? id
  const generating = () => view()?.guide?.status === 'generating'

  const send = async (action: 'generate' | 'stop') => {
    setSending(true)
    setFailure('')
    try {
      setView(
        await props.bridge.api.post<GuideView>(`${API}/${action}`, { taskId: props.taskId, profileId: profileId() }),
      )
    } catch (error) {
      setFailure(message(error))
    } finally {
      setSending(false)
    }
  }

  const mark = async (progress: ProgressMark) => {
    try {
      setView(await props.bridge.api.post<GuideView>(`${API}/progress`, { taskId: props.taskId, ...progress }))
    } catch (error) {
      setFailure(message(error))
    }
  }

  return (
    <Show when={props.taskId} fallback={<EmptyState align="start">Open a task to see its review guide.</EmptyState>}>
      <Stack gap="section">
        <Show when={view()?.hasChangeRequest}>
          <Toolbar variant="bar" size="sm" ariaLabel="Review guide">
            <Select
              size="sm"
              width="auto"
              label="Harness"
              value={profileId() ?? undefined}
              disabled={generating()}
              options={(view()?.profiles ?? []).map((profile) => ({ value: profile.id, label: profile.label }))}
              onChange={(value: string) => setPicked(value)}
            />
            <ToolbarSpacer />
            <Show
              when={generating()}
              fallback={
                <Button size="sm" busy={sending()} disabled={!profileId()} onPress={() => void send('generate')}>
                  {view()?.guide ? 'Regenerate' : 'Generate guide'}
                </Button>
              }
            >
              <Button size="sm" variant="ghost" busy={sending()} onPress={() => void send('stop')}>
                Stop
              </Button>
            </Show>
          </Toolbar>
        </Show>
        <Show when={failure()}>{(text) => <Alert>{text()}</Alert>}</Show>
        <Switch>
          <Match when={!view() && !failure()}>
            <EmptyState align="start" busy>
              Loading the guide…
            </EmptyState>
          </Match>
          <Match when={view() && !view()!.hasChangeRequest}>
            <EmptyState align="start" title="No change request">
              A guide needs a pull request or merge request on this task.
            </EmptyState>
          </Match>
          <Match when={view() && !view()!.profiles.length}>
            <EmptyState align="start" title="No harness to ask">
              Install Claude Code or Codex to write a guide.
            </EmptyState>
          </Match>
          <Match when={view() && !view()!.guide}>
            <EmptyState align="start" title="No guide yet">
              Pick a harness and press Generate guide. It reads the change in this task's worktree and arranges it for
              review.
            </EmptyState>
          </Match>
          <Match when={view()?.guide}>
            {(stored) => (
              <StoredGuideView
                stored={stored()}
                layout={props.layout}
                label={profileLabel(stored().profileId)}
                onSession={(id) => void props.bridge.ui.openDestination('session', id)}
                onReveal={(path, line, side) =>
                  void props.bridge.ui
                    .revealChangeRequestLine(path, line, side)
                    .catch((error: unknown) => setFailure(message(error)))
                }
                onRetry={() => void send('generate')}
                onMark={(progress) => void mark(progress)}
              />
            )}
          </Match>
        </Switch>
      </Stack>
    </Show>
  )
}

function StoredGuideView(props: {
  stored: StoredGuide
  layout: 'wide' | 'narrow'
  label: string
  onSession: (sessionId: string) => void
  onReveal: Reveal
  onRetry: () => void
  onMark: (progress: ProgressMark) => void
}) {
  const session = () =>
    props.stored.sessionId ? (
      <Link onPress={() => props.onSession(props.stored.sessionId!)}>Open the session</Link>
    ) : null
  return (
    <Switch>
      <Match when={props.stored.status === 'generating'}>
        <Stack>
          <EmptyState align="start" busy>
            {`${props.label} is writing the guide…`}
          </EmptyState>
          {session()}
        </Stack>
      </Match>
      <Match when={props.stored.status === 'failed'}>
        <Stack>
          <Alert title="The guide failed">{props.stored.error ?? 'The harness gave no reason.'}</Alert>
          <Inline>
            <Button size="sm" onPress={props.onRetry}>
              Try again
            </Button>
            {session()}
          </Inline>
        </Stack>
      </Match>
      <Match when={props.stored.guide}>
        {(guide) => (
          <Stack gap="section">
            <Show when={props.stored.status === 'stale'}>
              <Alert tone="warn">The change has new commits since this guide. Regenerate to cover them.</Alert>
            </Show>
            <GuidePath
              guide={guide()}
              progress={props.stored.progress}
              layout={props.layout}
              author={props.label}
              credit={
                <>
                  <Text tone="muted" wrap>
                    {`Written by ${props.label} for ${props.stored.headSha.slice(0, 7)} against ${props.stored.baseRef}.`}
                  </Text>
                  {session()}
                </>
              }
              coverage={coverageNotes(guide())}
              onReveal={props.onReveal}
              onMark={props.onMark}
            />
          </Stack>
        )}
      </Match>
    </Switch>
  )
}
