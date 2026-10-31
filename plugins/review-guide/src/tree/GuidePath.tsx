// The guide as a path: an overview, one page per step, and a wrap-up. The Guide pane draws it wide,
// with a rail beside the page. The column beside the change request's diff draws it narrow, with a
// stepper over the page and only the noted lines, because the full diff is in the next column.
import { createMemo, createSignal, For, Index, Match, Show, Switch, untrack, type JSX } from 'solid-js'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DetailColumn,
  DiffNote,
  Fold,
  Heading,
  Inline,
  Link,
  ListColumn,
  ListDetail,
  Markdown,
  Meter,
  Row,
  SectionHeader,
  Stack,
  StackedDiff,
  StatusDot,
  Text,
} from '@acorn/plugin-api/ui/tree'
import {
  TONE_LABELS,
  type DiffItem,
  type Guide,
  type GuideNote,
  type GuideProgress,
  type ProgressMark,
} from '../shared/guide'
import { hunkStart } from '../shared/hunk'
import { guidePath, openQuestions, OVERVIEW, stepPage, wrapUpDone, type PathNote, type PathStep } from '../shared/path'

// The host refuses a tree batch over 1 MiB. Only the open page draws its hunks, so this is for a
// single huge step: hunks past this much text wait behind a fold until they're opened.
const PAGE_BYTES = 256 * 1024

type Side = 'old' | 'new'
/** Show a line, or a file's first line, in the change request's diff. */
export type Reveal = (path: string, line?: number, side?: Side) => void

const TONES: Record<
  GuideNote['tone'],
  { label: string; tone: 'neutral' | 'warn' | 'danger'; dot: 'muted' | 'warn' | 'danger'; counted: string }
> = {
  explain: { label: TONE_LABELS.explain, tone: 'neutral', dot: 'muted', counted: 'explained' },
  attention: { label: TONE_LABELS.attention, tone: 'warn', dot: 'warn', counted: 'to look at closely' },
  risk: { label: TONE_LABELS.risk, tone: 'danger', dot: 'danger', counted: 'risk' },
}

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const noteLine = (note: PathNote) => `${note.path}:${note.line}${note.side === 'old' ? ' (deleted)' : ''}`

// The page each guide had open, by `place`, so a pane that's drawn again opens where the reader was.
// Leaving a pane unmounts its tree, and this lives as long as the plugin's worker does.
// shortcut: the worker ends 30 seconds after its last tree, and the guide then opens on the first page
// that isn't done; keep it in `bridge.state` if that proves too short.
const openPages = new Map<string, number>()

/** The overview is page 0, the steps are pages 1 to n, and the wrap-up is page n + 1. */
export function GuidePath(props: {
  guide: Guide
  progress: GuideProgress
  layout: 'wide' | 'narrow'
  /** Names this guide for the open page and scroll places it keeps, such as its task and creation time. */
  place: string
  author: string
  /** Alerts drawn above the page. */
  notices: JSX.Element
  /** Who wrote the guide, for the overview. */
  credit: JSX.Element
  /** What the coverage and note checks changed, as sentences. */
  coverage: string[]
  /** Whether the guide's lines are the change request's, so they hold its line conversations. */
  conversations: boolean
  onReveal: Reveal
  onMark: (mark: ProgressMark) => void
}) {
  const path = createMemo(() => guidePath(props.guide))
  const last = () => path().length + 1
  const pageKey = (page: number) => (page === 0 ? OVERVIEW : stepPage(page))
  const isDone = (page: number) =>
    page === last() ? wrapUpDone(path(), props.progress) : props.progress.pages.includes(pageKey(page))
  const doneCount = () => Array.from({ length: last() + 1 }, (_, page) => page).filter(isDone).length
  const minutes = () => path().reduce((total, step) => total + step.minutes, 0)

  // Opens on the page the reader had open, or else the first page not done.
  const [open, setOpen] = createSignal(
    untrack(() => {
      const remembered = openPages.get(props.place)
      if (remembered !== undefined && remembered <= last()) return remembered
      const first = Array.from({ length: last() }, (_, page) => page).find((page) => !isDone(page))
      return first ?? last()
    }),
  )
  const go = (page: number) => {
    setOpen(page)
    openPages.set(props.place, page)
    // Beside the diff, opening a step shows its first hunk there. In the Guide pane it would switch
    // panes, so it doesn't.
    const first = path()[page - 1]?.items[0]
    if (props.layout === 'narrow' && first) {
      const start = hunkStart(first.patch)
      props.onReveal(first.path, start?.line, start?.side)
    }
  }
  const markAndContinue = () => {
    props.onMark({ page: pageKey(open()), done: true })
    go(open() + 1)
  }

  // Explains notes fold on Got it. That's this view's, not progress.
  const [folded, setFolded] = createSignal<ReadonlySet<string>>(new Set())
  const fold = (key: string, next: boolean) =>
    setFolded((current) => {
      const copy = new Set(current)
      if (next) copy.add(key)
      else copy.delete(key)
      return copy
    })
  const notes = {
    checked: (key: string) => props.progress.notes.includes(key),
    folded: (key: string) => folded().has(key),
    onCheck: (key: string, done: boolean) => props.onMark({ note: key, done }),
    onFold: fold,
  }

  const progressLine = () => (
    <Stack gap="row">
      <Text tone="muted">{`${doneCount()} of ${last() + 1} done · ~${minutes()} min`}</Text>
      <Meter value={doneCount() / (last() + 1)} label="Review progress" />
    </Stack>
  )

  const page = () => (
    <Switch>
      <Match when={open() === 0}>
        <Overview
          path={path()}
          summary={props.guide.summary}
          credit={props.credit}
          coverage={props.coverage}
          onOpen={go}
          onStart={markAndContinue}
        />
      </Match>
      <Match when={open() === last()}>
        <WrapUp path={path()} checked={notes.checked} onCheck={notes.onCheck} onOpen={go} />
      </Match>
      <Match when={path()[open() - 1]}>
        {(step) => (
          <StepPage
            step={step()}
            count={path().length}
            next={path()[open()]?.title ?? 'Wrap up'}
            layout={props.layout}
            author={props.author}
            conversations={props.conversations}
            notes={notes}
            onReveal={props.onReveal}
            onBack={() => go(open() - 1)}
            onDone={markAndContinue}
          />
        )}
      </Match>
    </Switch>
  )

  return (
    <Show
      when={props.layout === 'wide'}
      fallback={
        <Stack gap="section">
          {props.notices}
          {progressLine()}
          <Inline wrap>
            <For each={Array.from({ length: last() + 1 }, (_, index) => index)}>
              {(index) => (
                <Button
                  size="xs"
                  variant={open() === index ? 'solid' : 'ghost'}
                  pressed={open() === index}
                  label={index === 0 ? 'Overview' : index === last() ? 'Wrap up' : path()[index - 1]!.title}
                  tip={index === 0 ? 'Overview' : index === last() ? 'Wrap up' : path()[index - 1]!.title}
                  onPress={() => go(index)}
                >
                  {isDone(index) ? '✓' : index === 0 ? '◎' : index === last() ? '⚑' : String(index)}
                </Button>
              )}
            </For>
          </Inline>
          {page()}
        </Stack>
      }
    >
      <ListDetail split listLabel="Review path" selection={pageKey(open())}>
        <ListColumn label="Review path" scroll scrollKey={`review-guide:${props.place}:rail`}>
          <Stack gap="section">
            <SectionHeader>Review path</SectionHeader>
            {progressLine()}
            <Stack gap="row">
              <PathRow
                marker={isDone(0) ? '✓' : '◎'}
                title="Overview"
                meta="What changed and why"
                selected={open() === 0}
                onPress={() => go(0)}
              />
              <Index each={path()}>
                {(step) => (
                  <PathRow
                    marker={isDone(step().number) ? '✓' : String(step().number)}
                    title={step().title}
                    meta={[
                      ...(step().kind ? [step().kind!] : []),
                      plural(step().items.length, 'hunk', 'hunks'),
                      `~${step().minutes} min`,
                    ].join(' · ')}
                    notes={step().notes}
                    selected={open() === step().number}
                    onPress={() => go(step().number)}
                  />
                )}
              </Index>
              <PathRow
                marker={isDone(last()) ? '✓' : '⚑'}
                title="Wrap up"
                meta="Decide and review"
                selected={open() === last()}
                onPress={() => go(last())}
              />
            </Stack>
          </Stack>
        </ListColumn>
        {/* Each page keeps its own scroll place, so the next page starts at its top. */}
        <DetailColumn scroll measure="pane" inset scrollKey={`review-guide:${props.place}:${pageKey(open())}`}>
          <Stack gap="section">
            {props.notices}
            {page()}
          </Stack>
        </DetailColumn>
      </ListDetail>
    </Show>
  )
}

/** A page's row in the rail: its number or a check, its title, and under it the meta and one dot per
 *  note in its tone. */
function PathRow(props: {
  marker: string
  title: string
  meta: string
  notes?: PathNote[]
  selected: boolean
  onPress: () => void
}) {
  return (
    <Row variant="stacked" leading={props.marker} selected={props.selected} onPress={props.onPress}>
      <Text>{props.title}</Text>
      <Inline gap="inline">
        <Text tone="muted">{props.meta}</Text>
        <Index each={props.notes ?? []}>
          {(note) => <StatusDot tone={TONES[note().tone].dot} tip={TONES[note().tone].label} />}
        </Index>
      </Inline>
    </Row>
  )
}

function Overview(props: {
  path: PathStep[]
  summary: string
  credit: JSX.Element
  coverage: string[]
  onOpen: (page: number) => void
  onStart: () => void
}) {
  const items = () => props.path.flatMap((step) => step.items)
  const notes = () => props.path.flatMap((step) => step.notes)
  const counts = () =>
    [
      plural(props.path.length, 'step', 'steps'),
      `${plural(items().length, 'hunk', 'hunks')} in ${plural(new Set(items().map((item) => item.path)).size, 'file', 'files')}`,
      `+${props.path.reduce((total, step) => total + step.added, 0)} −${props.path.reduce((total, step) => total + step.removed, 0)}`,
      `~${props.path.reduce((total, step) => total + step.minutes, 0)} min`,
    ].join(' · ')
  const goals = () => props.path.filter((step) => step.goal).map((step) => `- ${step.goal}`)
  return (
    <Stack gap="section">
      <Heading level={2} eyebrow="Overview">
        What changed and why
      </Heading>
      <Stack>
        <Markdown text={props.summary} />
        {props.credit}
      </Stack>
      <Inline wrap>
        <Text tone="muted" wrap>
          {counts()}
        </Text>
        <For each={(['risk', 'attention', 'explain'] as const).filter((tone) => notes().some((n) => n.tone === tone))}>
          {(tone) => (
            <Badge size="xs" tone={TONES[tone].tone}>
              {`${notes().filter((note) => note.tone === tone).length} ${TONES[tone].counted}`}
            </Badge>
          )}
        </For>
      </Inline>
      <Show when={goals().length}>
        <Stack gap="row">
          <Heading level={3}>By the end you'll know</Heading>
          <Markdown text={goals().join('\n')} />
        </Stack>
      </Show>
      <Stack gap="row">
        <Index each={props.path}>
          {(step) => (
            <Card interactive pad="sm" onPress={() => props.onOpen(step().number)}>
              <Stack gap="none">
                <Text tone="muted">{`Step ${step().number}${step().kind ? ` · ${step().kind}` : ''}`}</Text>
                <Text emphasis="strong" wrap>
                  {step().title}
                </Text>
                <Show when={step().goal}>
                  <Text wrap>{`You'll know ${step().goal}`}</Text>
                </Show>
              </Stack>
            </Card>
          )}
        </Index>
      </Stack>
      <Show
        when={props.coverage.length}
        fallback={
          <Text tone="muted" wrap>
            Every hunk of the change is in exactly one step.
          </Text>
        }
      >
        <For each={props.coverage}>{(sentence) => <Alert tone="warn">{sentence}</Alert>}</For>
      </Show>
      <Inline wrap>
        <Button variant="solid" onPress={props.onStart}>
          Start the path
        </Button>
      </Inline>
    </Stack>
  )
}

type NoteState = {
  checked: (key: string) => boolean
  folded: (key: string) => boolean
  onCheck: (key: string, done: boolean) => void
  onFold: (key: string, folded: boolean) => void
}

function StepPage(props: {
  step: PathStep
  count: number
  next: string
  layout: 'wide' | 'narrow'
  author: string
  conversations: boolean
  notes: NoteState
  onReveal: Reveal
  onBack: () => void
  onDone: () => void
}) {
  // Whether each hunk draws now or waits behind a fold, so one huge step stays under the batch limit.
  const drawNow = createMemo(() => {
    let bytes = 0
    return props.step.items.map((item, index) => (bytes += item.patch.length) <= PAGE_BYTES || index === 0)
  })
  return (
    <Stack gap="section">
      <Heading
        level={2}
        eyebrow={`Step ${props.step.number} of ${props.count}${props.step.kind ? ` · ${props.step.kind}` : ''} · ~${props.step.minutes} min`}
      >
        {props.step.title}
      </Heading>
      <Show when={props.step.goal}>
        <Text emphasis="strong" wrap>{`After this step you'll know ${props.step.goal}`}</Text>
      </Show>
      <Show when={props.step.why}>
        <Markdown text={props.step.why} />
      </Show>
      <Index each={props.step.items}>
        {(item, index) => {
          const hunk = () => (
            <Hunk
              item={item()}
              notes={props.step.notes.filter((note) => note.hunk === item().id)}
              layout={props.layout}
              author={props.author}
              conversations={props.conversations}
              state={props.notes}
              onReveal={props.onReveal}
            />
          )
          return (
            <Show when={drawNow()[index]} fallback={<Later label={item().path}>{hunk()}</Later>}>
              {hunk()}
            </Show>
          )
        }}
      </Index>
      <Inline wrap>
        <Text tone="muted" wrap>
          {`Next: ${props.next}`}
        </Text>
        <Button onPress={props.onBack}>Back</Button>
        <Button variant="solid" onPress={props.onDone}>
          Mark reviewed & continue
        </Button>
      </Inline>
    </Stack>
  )
}

/** A closed fold that draws its children only once it's opened. */
function Later(props: { label: string; children: JSX.Element }) {
  const [open, setOpen] = createSignal(false)
  return (
    <Fold label={props.label} open={open()} onOpenChange={setOpen}>
      <Show when={open()}>{props.children}</Show>
    </Fold>
  )
}

/** A hunk under a link to it in the change request's diff, named by its path and first line, with
 *  each note under the line it's on. With `conversations`, each line holds the change request's agent
 *  card for it, with the line's notes as its opening messages, and ✦ opens it in place. The host draws
 *  the card. Without, or where the host has no card, ✦ shows the line in the change request's diff.
 *  Beside the diff it draws only the noted lines, and nothing under the link for a hunk with no notes. */
function Hunk(props: {
  item: DiffItem
  notes: PathNote[]
  layout: 'wide' | 'narrow'
  author: string
  conversations: boolean
  state: NoteState
  onReveal: Reveal
}) {
  const start = () => hunkStart(props.item.patch)
  const label = () => (start()?.side === 'new' ? `${props.item.path}:${start()!.line}` : props.item.path)
  const narrow = () => props.layout === 'narrow'
  return (
    <Stack gap="row">
      <Link onPress={() => props.onReveal(props.item.path, start()?.line, start()?.side)}>{label()}</Link>
      <Show when={props.item.patch} fallback={<Text>{props.item.note}</Text>}>
        <Show when={!narrow() || props.notes.length}>
          <StackedDiff
            path={props.item.path}
            patch={props.item.patch}
            noteContext={narrow() ? 0 : undefined}
            conversations={props.conversations}
            onActivate={(place: { side: Side; line: number }) =>
              props.onReveal(props.item.path, place.line, place.side)
            }
          >
            <Index each={props.notes}>
              {(note) => <Note note={note()} author={props.author} state={props.state} onReveal={props.onReveal} />}
            </Index>
          </StackedDiff>
        </Show>
      </Show>
    </Stack>
  )
}

function Note(props: { note: PathNote; author: string; state: NoteState; onReveal: Reveal }) {
  const key = () => props.note.key
  const reveal = () => props.onReveal(props.note.path, props.note.line, props.note.side)
  return (
    <DiffNote
      side={props.note.side}
      line={props.note.line}
      tone={TONES[props.note.tone].tone}
      label={TONES[props.note.tone].label}
      author={props.author}
      title={props.note.title}
      body={props.note.body}
      open={!props.state.folded(key())}
      onOpenChange={(open: boolean) => props.state.onFold(key(), !open)}
    >
      <Inline wrap>
        <Button size="sm" variant="ghost" onPress={reveal}>
          Show in diff
        </Button>
        <Show
          when={props.note.tone !== 'explain'}
          fallback={
            <Button size="sm" variant="ghost" onPress={() => props.state.onFold(key(), true)}>
              Got it
            </Button>
          }
        >
          <Button
            size="sm"
            variant="ghost"
            pressed={props.state.checked(key())}
            onPress={() => props.state.onCheck(key(), !props.state.checked(key()))}
          >
            {props.state.checked(key()) ? '✓ Checked' : 'Mark checked'}
          </Button>
        </Show>
      </Inline>
    </DiffNote>
  )
}

function WrapUp(props: {
  path: PathStep[]
  checked: (key: string) => boolean
  onCheck: (key: string, done: boolean) => void
  onOpen: (page: number) => void
}) {
  const questions = () => openQuestions(props.path)
  const left = () => questions().filter(({ note }) => !props.checked(note.key)).length
  return (
    <Stack gap="section">
      <Heading level={2} eyebrow="Wrap up">
        What's left to decide
      </Heading>
      <Show when={questions().length} fallback={<Text wrap>The guide flagged nothing to decide.</Text>}>
        <Text
          wrap
        >{`The guide flagged ${plural(questions().length, 'thing', 'things')}. Check each one once you've made up your mind.`}</Text>
        <Stack gap="row">
          <Index each={questions()}>
            {(entry) => (
              <Inline wrap>
                <Checkbox
                  label={entry().note.title}
                  checked={props.checked(entry().note.key)}
                  onChange={(checked: boolean) => props.onCheck(entry().note.key, checked)}
                />
                <Text tone="muted">{noteLine(entry().note)}</Text>
                <Link onPress={() => props.onOpen(entry().step.number)}>{`Step ${entry().step.number}`}</Link>
                <Badge size="xs" tone={TONES[entry().note.tone].tone}>
                  {TONES[entry().note.tone].label}
                </Badge>
              </Inline>
            )}
          </Index>
        </Stack>
        <Text emphasis="strong">{left() ? `${left()} still open` : 'All checked.'}</Text>
      </Show>
      <Text tone="muted" wrap>
        The guide doesn't approve or post anything. When you're ready, leave your review in Details.
      </Text>
      <Inline wrap>
        <Button onPress={() => props.onOpen(props.path.length)}>Back</Button>
      </Inline>
    </Stack>
  )
}
