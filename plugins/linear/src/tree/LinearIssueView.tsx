import { createSignal, For, Show, type JSX } from 'solid-js'
import {
  Badge, Button, Card, Chip, ChipRow, Composer, CopyButton, EmptyState, Facts, Heading, Inline, Markdown,
  Meter, Row, Section, Stack, TabPanel, Tabs, Text, Toolbar, ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import type { LinearComment, LinearIssueDetail, LinearRelatedIssue } from '../shared/api'
import { priorityMeta } from '../shared/triage'
import { formatDate, relativeTime } from './model'

// One Linear ticket, as a tree of acorn's own components. Three tabs, Overview, Activity, and
// Comments, all fed by one detail request.
//
// Nothing here draws a pixel: what used to be a header div with three classes is a `Heading`, the
// sub-issue progress bar is a `Meter`, the related-issue buttons are `Row`s, and the comment boxes are
// `Composer`s. The stylesheet this file needed is gone, and with it the job of keeping it in step with
// the shell's appearance packs.
//
// Two things live outside this file. The panel chrome belongs to whoever opened the panel
// (client-core/host/frames/PluginRefPanel.tsx). The ticket switcher for a task linking several
// tickets sits in app.tsx beside the task read.

// Glyph per activity kind (Linear-style compact feed).
const ACTIVITY_GLYPH: Record<string, string> = { created: '✦', state: '◐', assignee: '○', label: '▣', title: '✎' }

const isDone = (issue: LinearRelatedIssue) => issue.state?.type === 'completed' || issue.state?.type === 'canceled'

export type LinearIssueViewProps = {
  issue: LinearIssueDetail
  activeTab: string
  refreshing: boolean
  posting: boolean
  postError: string
  /** Present when a relation row re-targeted the view, so there is somewhere to go back to. */
  overridden: boolean
  onSelect(id: string): void
  onRefresh(): void
  onBack(): void
  onOpenRelated(identifier: string): void
  onComment(body: string, parentId?: string): void
  onCopy(text: string): void
  /**
   * A link in rendered markdown, by its href. Where it goes is not this view's decision: a Linear
   * ticket re-points the view and anything else goes to the host, and both halves need the current
   * target and the bridge, which this file does not have.
   */
  onLink(href: string): void
}

export function LinearIssueView(props: LinearIssueViewProps) {
  const [replyingId, setReplyingId] = createSignal<string | null>(null)
  const issue = () => props.issue
  const topComments = () => issue().comments.filter((entry) => !entry.parentId)
  const repliesOf = (id: string) => issue().comments.filter((entry) => entry.parentId === id)

  // Facts values are strings on this path, because a tree's props are JSON on a message port. The one
  // fact that carried a control — the branch name and its copy button — is a toolbar of its own below.
  const facts = () => [
    issue().assignee ? { label: 'Assignee', value: issue().assignee! } : null,
    issue().creator ? { label: 'Opened by', value: `${issue().creator} ${relativeTime(issue().createdAt)}`.trim() } : null,
    issue().estimate != null ? { label: 'Estimate', value: `${issue().estimate} pts` } : null,
    issue().cycle ? { label: 'Cycle', value: `C${issue().cycle!.number}${issue().cycle!.endsAt ? ` → ${formatDate(issue().cycle!.endsAt)}` : ''}` } : null,
    issue().dueDate ? { label: 'Due', value: formatDate(issue().dueDate) } : null,
    issue().team ? { label: 'Team', value: issue().team!.name } : null,
    issue().project ? { label: 'Project', value: issue().project!.name } : null,
  ].filter((fact) => fact !== null)

  const relatedRow = (related: LinearRelatedIssue, done?: boolean) => (
    <Row
      onPress={() => props.onOpenRelated(related.identifier)}
      leading={done === undefined ? undefined : done ? '✓' : '○'}
      meta={related.state?.name}
    >
      <Inline>
        <Text emphasis="mono" tone={done ? 'muted' : 'neutral'}>{related.identifier}</Text>
        <Text tone={done ? 'muted' : 'neutral'}>{related.title}</Text>
      </Inline>
    </Row>
  )

  const comment = (entry: LinearComment, isReply: boolean) => (
    <Card pad="sm" stripe={isReply ? 'accent' : undefined}>
      <Stack gap="row">
        {/* An `Inline`, not a `Toolbar`: a bar inside a card is inset by the card's padding and then
            pads itself again, so the author's name sat further in than their own words and the strip
            stood taller than the line it holds. Github's inline threads put this meta line flush with
            the comment body, and so does this one now. */}
        <Inline>
          <Text emphasis="strong">{entry.author ?? 'Unknown'}</Text>
          <Show when={relativeTime(entry.createdAt)}>{(age) => <Text tone="muted">{age()}</Text>}</Show>
          <ToolbarSpacer />
          <Show when={!isReply}>
            <Button
              size="sm"
              variant="bare"
              onPress={() => setReplyingId(replyingId() === entry.id ? null : entry.id)}
            >
              Reply
            </Button>
          </Show>
        </Inline>
        {/* The host renders and sanitises the markdown. What used to be an `innerHTML` write inside the
            frame is now a node with a `text` prop, which is the only way a stranger's markup can reach
            the shell's DOM at all. */}
        <Markdown text={entry.body} onSelect={props.onLink} onCopy={props.onCopy} />
        <Show when={repliesOf(entry.id).length}>
          <Stack gap="row"><For each={repliesOf(entry.id)}>{(child) => comment(child, true)}</For></Stack>
        </Show>
        <Show when={replyingId() === entry.id}>
          <Composer
            value=""
            rows={3}
            placeholder="Write a reply…"
            submitLabel="Reply"
            busy={props.posting}
            error={props.postError}
            onSubmit={(body: string) => {
              props.onComment(body, entry.id)
              setReplyingId(null)
            }}
          />
        </Show>
      </Stack>
    </Card>
  )

  return (
    <Stack gap="section">
      <Toolbar variant="bar">
        <Heading level={1} eyebrow={issue().identifier}>{issue().title}</Heading>
        <ToolbarSpacer />
        <Show when={props.overridden}>
          <Button size="sm" variant="bare" onPress={props.onBack}>← back</Button>
        </Show>
        <Button size="sm" busy={props.refreshing} onPress={props.onRefresh}>Refresh</Button>
        {/* The clipboard, not `ui.openUrl`. The host resolves a URL through its content-link ladder,
            linear's recogniser claims `linear.app/…/issue/…`, and it resolves to the ticket already on
            screen, so the button would re-open where the reader is. See docs/integrations.md § Linear. */}
        <Button size="sm" onPress={() => props.onCopy(issue().url)}>Copy link</Button>
      </Toolbar>

      <ChipRow ariaLabel="Ticket status">
        <Show when={issue().state}>
          {(state) => <Chip color={state().color}>{state().name}</Chip>}
        </Show>
        <Show when={priorityMeta(issue().priority, issue().priorityLabel).level !== 'none'}>
          <Badge tone="warn" size="xs">{priorityMeta(issue().priority, issue().priorityLabel).label}</Badge>
        </Show>
        <For each={issue().labels ?? []}>
          {(label) => <Chip color={label.color}>{label.name}</Chip>}
        </For>
      </ChipRow>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'activity', label: 'Activity', count: issue().activity.length },
          { id: 'comments', label: 'Comments', count: issue().comments.length },
        ]}
        active={props.activeTab}
        onChange={props.onSelect}
        idPrefix="linear"
        ariaLabel="Linear ticket sections"
      />

      <TabPanel idPrefix="linear" id="overview" active={props.activeTab}>
        <Stack gap="section">
          <Facts items={facts()} />
          {/* `CopyButton` rather than a `Button` reading "Copy": the branch name is the whole point of
              the bar, and a word beside it competes with it for the eye. `always`, because the kit
              takes no class and this tree has no way to give the bar the `.copyable` the button's
              hover reveal keys off. No `onCopy` either — the host draws this button in the shell's
              own DOM, so it reaches the real clipboard, and `onCopy` is not one of the eleven event
              names a handler may cross the wire under. */}
          <Show when={issue().branchName}>
            {(branch) => (
              <Toolbar variant="bar" size="sm">
                <Text emphasis="mono">{branch()}</Text>
                <CopyButton text={branch()} always title="Copy the branch name" />
              </Toolbar>
            )}
          </Show>

          <Show when={issue().description} fallback={<Text tone="muted">No description.</Text>}>
            {(description) => <Markdown text={description()} onSelect={props.onLink} onCopy={props.onCopy} />}
          </Show>

          <Show when={(issue().attachments ?? []).length}>
            <Section label="Links">
              <For each={issue().attachments}>
                {(attachment) => (
                  <Row onPress={() => props.onLink(attachment.url)} meta={attachment.sourceType}>
                    <Inline>
                      <Text>{attachment.title}</Text>
                      {/* Alongside, because an attachment is what a reader most often pastes somewhere,
                          and unlike the header URL it does not point back to this view. */}
                      <Button size="sm" variant="bare" onPress={() => props.onCopy(attachment.url)}>Copy link</Button>
                    </Inline>
                  </Row>
                )}
              </For>
            </Section>
          </Show>

          <Show when={issue().parent || (issue().children ?? []).length}>
            <SubIssues issue={issue()} row={relatedRow} />
          </Show>

          <Show when={(issue().relations ?? []).length}>
            <Section label="Relations">
              <For each={issue().relations}>
                {(relation) => (
                  <Stack gap="none">
                    <Text emphasis="eyebrow">{relation.label}</Text>
                    {relatedRow(relation.issue)}
                  </Stack>
                )}
              </For>
            </Section>
          </Show>
        </Stack>
      </TabPanel>

      <TabPanel idPrefix="linear" id="activity" active={props.activeTab}>
        <Show when={issue().activity.length} fallback={<Text tone="muted">No activity yet.</Text>}>
          <For each={issue().activity}>
            {(entry) => (
              <Row
                density="compact"
                leading={ACTIVITY_GLYPH[entry.icon] ?? '•'}
                meta={relativeTime(entry.createdAt)}
              >
                <Inline>
                  <Show when={entry.actor}>{(name) => <Text emphasis="strong">{name()}</Text>}</Show>
                  <Text>{entry.text}</Text>
                </Inline>
              </Row>
            )}
          </For>
        </Show>
      </TabPanel>

      <TabPanel idPrefix="linear" id="comments" active={props.activeTab}>
        <Stack gap="stack">
          <Show when={topComments().length} fallback={<EmptyState>No comments yet.</EmptyState>}>
            <For each={topComments()}>{(entry) => comment(entry, false)}</For>
          </Show>
          <Composer
            value=""
            rows={3}
            placeholder="Leave a comment…"
            busy={props.posting}
            error={replyingId() ? '' : props.postError}
            onSubmit={(body: string) => props.onComment(body)}
          />
        </Stack>
      </TabPanel>
    </Stack>
  )
}

/** The parent-and-children block, with the done count as a `Meter`: the progress bar it replaces was a
 *  div whose width this plugin computed in percent, which is a pixel decision the kit now owns. */
function SubIssues(props: {
  issue: LinearIssueDetail
  row: (related: LinearRelatedIssue, done?: boolean) => JSX.Element
}) {
  const children = () => props.issue.children ?? []
  const doneCount = () => children().filter(isDone).length
  return (
    <Section label={children().length ? 'Sub-issues' : 'Parent'}>
      <Stack gap="row">
        <Show when={children().length}>
          <Meter
            value={Math.round((doneCount() / children().length) * 100)}
            label={`${doneCount()} of ${children().length} done`}
            size="sm"
          />
        </Show>
        <Show when={props.issue.parent}>
          {(parent) => (
            <Stack gap="none">
              <Text emphasis="eyebrow">Parent</Text>
              {props.row(parent())}
            </Stack>
          )}
        </Show>
        <For each={children()}>{(child) => props.row(child, isDone(child))}</For>
      </Stack>
    </Section>
  )
}
