import { createEffect, createSignal, For, Match, on, onCleanup, Show, Switch } from 'solid-js'
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Fold,
  Inline,
  Link,
  Markdown,
  Select,
  Stack,
  StackedDiff,
  Text,
  Toolbar,
  ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import {
  CHANGED_CHANNEL,
  type DiffItem,
  type Guide,
  type GuideNote,
  type GuideView,
  type StoredGuide,
} from '../shared/guide'
import { hunkStart } from '../shared/hunk'

const API = '/v1/p/review-guide/guide'

// The host refuses a tree batch over 1 MiB, so the first draw opens steps only until their hunk text
// reaches this much. The rest open on demand.
const FIRST_DRAW_BYTES = 256 * 1024

const message = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.'

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const TONES: Record<GuideNote['tone'], { label: string; tone: 'neutral' | 'warn' | 'danger' }> = {
  explain: { label: 'Explains', tone: 'neutral' },
  attention: { label: 'Look closely', tone: 'warn' },
  risk: { label: 'Risk', tone: 'danger' },
}

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

/** The task pane. The host mounts it with the pane's task. */
export function GuidePane(props: { taskId?: string; bridge: AcornBridge }) {
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
                label={profileLabel(stored().profileId)}
                onSession={(id) => void props.bridge.ui.openDestination('session', id)}
                onReveal={(item) => {
                  const start = hunkStart(item.patch)
                  props.bridge.ui
                    .revealChangeRequestLine(item.path, start?.line, start?.side)
                    .catch((error: unknown) => setFailure(message(error)))
                }}
                onRetry={() => void send('generate')}
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
  label: string
  onSession: (sessionId: string) => void
  onReveal: (item: DiffItem) => void
  onRetry: () => void
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
            <Stack>
              <Markdown text={guide().summary} />
              <Text tone="muted">
                {`Written by ${props.label} for ${props.stored.headSha.slice(0, 7)} against ${props.stored.baseRef}.`}
              </Text>
              {session()}
            </Stack>
            <For each={coverageNotes(guide())}>{(note) => <Alert tone="warn">{note}</Alert>}</For>
            <GuideSteps guide={guide()} onReveal={props.onReveal} />
          </Stack>
        )}
      </Match>
    </Switch>
  )
}

function GuideSteps(props: { guide: Guide; onReveal: (item: DiffItem) => void }) {
  const blocks = () => [
    ...props.guide.steps,
    ...(props.guide.uncovered.length
      ? [{ title: 'Not covered by the guide', goal: '', why: '', items: props.guide.uncovered, notes: [] }]
      : []),
  ]
  // Which steps are open, by index. Seeded so the first draw stays under the batch limit.
  const [open, setOpen] = createSignal(
    blocks().reduce<{ bytes: number; open: Set<number> }>(
      (state, block, index) => {
        state.bytes += block.items.reduce((total, item) => total + item.patch.length, 0)
        if (index === 0 || state.bytes <= FIRST_DRAW_BYTES) state.open.add(index)
        return state
      },
      { bytes: 0, open: new Set() },
    ).open,
  )
  const toggle = (index: number, next: boolean) =>
    setOpen((current) => {
      const copy = new Set(current)
      if (next) copy.add(index)
      else copy.delete(index)
      return copy
    })
  return (
    <For each={blocks()}>
      {(block, index) => (
        <Fold
          label={block.title}
          count={block.items.length}
          open={open().has(index())}
          onOpenChange={(next: boolean) => toggle(index(), next)}
        >
          <Show when={open().has(index())}>
            <Stack>
              <Show when={block.goal}>
                <Text emphasis="strong">{`After this step you'll know ${block.goal}`}</Text>
              </Show>
              <Show when={block.why}>
                <Markdown text={block.why} />
              </Show>
              <For each={block.items}>
                {(item) => (
                  <Hunk
                    item={item}
                    notes={block.notes.filter((note) => note.hunk === item.id)}
                    onReveal={props.onReveal}
                  />
                )}
              </For>
            </Stack>
          </Show>
        </Fold>
      )}
    </For>
  )
}

/** A hunk under a link to it in the change request's diff, named by its path and first line, with
 *  its notes after it. */
function Hunk(props: { item: DiffItem; notes: GuideNote[]; onReveal: (item: DiffItem) => void }) {
  const start = () => hunkStart(props.item.patch)
  const label = () => (start()?.side === 'new' ? `${props.item.path}:${start()!.line}` : props.item.path)
  return (
    <Stack gap="row">
      <Link onPress={() => props.onReveal(props.item)}>{label()}</Link>
      <Show when={props.item.patch} fallback={<Text>{props.item.note}</Text>}>
        <StackedDiff path={props.item.path} patch={props.item.patch} />
      </Show>
      <For each={props.notes}>{(note) => <Note note={note} />}</For>
    </Stack>
  )
}

function Note(props: { note: GuideNote }) {
  const tone = () => TONES[props.note.tone]
  return (
    <Stack gap="inline">
      <Inline wrap>
        <Badge size="xs" tone={tone().tone}>
          {tone().label}
        </Badge>
        <Text emphasis="strong">{props.note.title}</Text>
        <Text tone="muted">{`${props.note.side === 'old' ? 'Deleted line' : 'Line'} ${props.note.line}`}</Text>
      </Inline>
      <Markdown text={props.note.body} />
    </Stack>
  )
}
