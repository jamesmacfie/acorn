import { createEffect, createSignal, Match, on, onCleanup, Show, Switch, type JSX } from 'solid-js'
import {
  Alert,
  Button,
  EmptyState,
  Icon,
  Inline,
  Link,
  Stack,
  Text,
  Toolbar,
  ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import {
  CHANGED_CHANNEL,
  type GenerateRequest,
  type Guide,
  type GuideView,
  type ProgressMark,
  type StoredGuide,
} from '../shared/guide'
import { errorMessage, GenerateModal } from './GenerateModal'
import { GuidePath, plural, type Reveal } from './GuidePath'

const API = '/v1/p/review-guide/guide'

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
  const [failure, setFailure] = createSignal('')
  const [stopping, setStopping] = createSignal(false)
  const [asking, setAsking] = createSignal(false)

  const load = async () => {
    const taskId = props.taskId
    if (!taskId) return
    try {
      const next = await props.bridge.api.get<GuideView>(`${API}?taskId=${encodeURIComponent(taskId)}`)
      if (taskId !== props.taskId) return
      setView(next)
      setFailure('')
    } catch (error) {
      if (taskId === props.taskId) setFailure(errorMessage(error))
    }
  }
  createEffect(
    on(
      () => props.taskId,
      () => void load(),
    ),
  )
  onCleanup(props.bridge.events.on(CHANGED_CHANNEL, () => void load()))

  const profileLabel = (id: string) => view()?.profiles.find((profile) => profile.id === id)?.label ?? id
  const generating = () => view()?.guide?.status === 'generating'

  // The dialog shows a failure itself, so this throws rather than setting `failure`.
  const generate = async (request: GenerateRequest) => {
    setFailure('')
    setView(await props.bridge.api.post<GuideView>(`${API}/generate`, { taskId: props.taskId, ...request }))
  }

  const stop = async () => {
    setStopping(true)
    setFailure('')
    try {
      setView(await props.bridge.api.post<GuideView>(`${API}/stop`, { taskId: props.taskId }))
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setStopping(false)
    }
  }

  const mark = async (progress: ProgressMark) => {
    try {
      setView(await props.bridge.api.post<GuideView>(`${API}/progress`, { taskId: props.taskId, ...progress }))
    } catch (error) {
      setFailure(errorMessage(error))
    }
  }

  const failureAlert = () => <Show when={failure()}>{(text) => <Alert>{text()}</Alert>}</Show>
  // Everything but a ready guide is a message under the toolbar.
  const padded = (children: JSX.Element) => (
    <Stack gap="section">
      {failureAlert()}
      {children}
    </Stack>
  )

  const content = () => (
    <>
      <Show when={view()?.hasChangeRequest}>
        {/* The pane's own bar is chrome at full height. Beside the diff it's a strip inside a tab. */}
        <Toolbar variant="bar" size={props.layout === 'narrow' ? 'sm' : undefined} ariaLabel="Review guide">
          <ToolbarSpacer />
          <Show
            when={generating()}
            fallback={
              <Button size="sm" disabled={!view()?.profiles.length} onPress={() => setAsking(true)}>
                <Icon name="sparkles" />
                {view()?.guide ? 'Regenerate' : 'Generate guide'}
              </Button>
            }
          >
            <Button size="sm" variant="ghost" busy={stopping()} onPress={() => void stop()}>
              Stop
            </Button>
          </Show>
        </Toolbar>
      </Show>
      <Switch>
        <Match when={!view() && !failure()}>
          {padded(
            <EmptyState align="start" busy>
              Loading the guide…
            </EmptyState>,
          )}
        </Match>
        <Match when={!view()}>{padded(null)}</Match>
        <Match when={!view()!.hasChangeRequest}>
          {padded(
            <EmptyState align="start" title="No change request">
              A guide needs a pull request or merge request on this task.
            </EmptyState>,
          )}
        </Match>
        <Match when={!view()!.profiles.length}>
          {padded(
            <EmptyState align="start" title="No harness to ask">
              Install Claude Code or Codex to write a guide.
            </EmptyState>,
          )}
        </Match>
        <Match when={!view()!.guide}>
          {padded(
            <EmptyState align="start" title="No guide yet">
              Press Generate guide to pick a harness. It reads the change in this task's worktree and arranges it for
              review.
            </EmptyState>,
          )}
        </Match>
        <Match when={view()?.guide}>
          {(stored) => (
            <StoredGuideView
              stored={stored()}
              taskId={props.taskId!}
              layout={props.layout}
              label={profileLabel(stored().profileId)}
              failure={failureAlert()}
              padded={padded}
              onSession={(id) => void props.bridge.ui.openDestination('session', id)}
              onReveal={(path, line, side, ask) =>
                void props.bridge.ui
                  .revealChangeRequestLine(path, line, side, ask && { ask })
                  .catch((error: unknown) => setFailure(errorMessage(error)))
              }
              onRetry={() => setAsking(true)}
              onMark={(progress) => void mark(progress)}
            />
          )}
        </Match>
      </Switch>
      <Show when={asking()}>
        <GenerateModal
          bridge={props.bridge}
          title={view()?.guide ? 'Regenerate the guide' : 'Generate a guide'}
          profileId={view()?.profileId ?? null}
          onGenerate={generate}
          onDismiss={() => setAsking(false)}
        />
      </Show>
    </>
  )

  // Wide, the toolbar and the guide's split sit straight in the pane's region, because the region drops
  // its side padding only for a split that is its own child. Narrow, the column is one stack.
  return (
    <Show when={props.taskId} fallback={<EmptyState align="start">Open a task to see its review guide.</EmptyState>}>
      <Show when={props.layout === 'wide'} fallback={<Stack gap="section">{content()}</Stack>}>
        {content()}
      </Show>
    </Show>
  )
}

function StoredGuideView(props: {
  stored: StoredGuide
  taskId: string
  layout: 'wide' | 'narrow'
  label: string
  /** The pane's failure, if any, drawn above the page. */
  failure: JSX.Element
  /** Wraps a state other than a ready guide, under the failure. */
  padded: (children: JSX.Element) => JSX.Element
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
        {props.padded(
          <Stack>
            <EmptyState align="start" busy>
              {`${props.label} is writing the guide…`}
            </EmptyState>
            {session()}
          </Stack>,
        )}
      </Match>
      <Match when={props.stored.status === 'failed'}>
        {props.padded(
          <Stack>
            <Alert title="The guide failed">{props.stored.error ?? 'The harness gave no reason.'}</Alert>
            <Inline>
              <Button size="sm" onPress={props.onRetry}>
                Try again
              </Button>
              {session()}
            </Inline>
          </Stack>,
        )}
      </Match>
      <Match when={props.stored.guide}>
        {(guide) => (
          <GuidePath
            guide={guide()}
            progress={props.stored.progress}
            layout={props.layout}
            place={`${props.taskId}:${props.stored.createdAt}`}
            author={props.label}
            notices={
              <>
                {props.failure}
                <Show when={props.stored.status === 'stale'}>
                  <Alert tone="warn">The change has new commits since this guide. Regenerate to cover them.</Alert>
                </Show>
              </>
            }
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
        )}
      </Match>
    </Switch>
  )
}
