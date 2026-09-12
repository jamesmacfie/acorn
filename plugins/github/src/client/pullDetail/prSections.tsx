import { createSignal, For, Show } from 'solid-js'
import {
  CHECK_TONE, checkStatusTone, checksState, FAILED_STATUSES, railDotProps,
} from '@acorn/plugin-api/client'
import {
  Button, Chip, ChipRow, CopyButton, Picker, Row, Rows, Stack, StatusDot, Text, UserAvatar,
  type KitSection,
} from '@acorn/plugin-api/ui'
import { ProviderHtml } from '@acorn/plugin-api/ui/host'
import type { Label } from '../../shared/api'
import { PrConversation } from './Conversation'
import { PrFileList } from './PrFiles'
import type { PrModel } from './prModel'

// What a pull request is made of, as a list a host arranges (`Sections`, docs/ui-design.md § The
// closed kit).
//
// These were seven `Fold`s written down the middle of ./PrOverview.tsx and ./PrPane.tsx, and the two
// files had drifted: browse showed Files and Comments, the pane showed the same two, and each had its
// own copy of the column that held them. The list is here once now, and each host decides what a
// section is — a fold beside the diff on a desktop, a tab in a terminal.
//
// A section that has nothing to say is left out rather than drawn empty. That is a decision about the
// pull request rather than about the screen, which is why it is made here and not in either host: a
// repository with no Linear links has no Integrations tab, on any host.

function Description(props: { model: PrModel; onLinkClick: (event: MouseEvent) => void }) {
  const [text, setText] = createSignal('')
  return (
    <>
      <CopyButton text={text} title="Copy description" />
      <ProviderHtml
        html={props.model.pull()?.body ?? ''}
        refs={props.model.refPrefixes()}
        onLinkClick={props.onLinkClick}
        onText={setText}
      />
    </>
  )
}

function Integrations(props: { model: PrModel }) {
  const model = () => props.model
  return (
    <Rows
      id={`gh-integrations:${model().scope.number}`}
      ariaLabel="Linked tickets"
      items={model().linearRefs().map((ref) => ({ key: ref.item, label: ref.item }))}
    >
      {(item, itemProps) => {
        const summary = () => model().linearSummary().get(item.key)
        const url = () => model().linearRefs().find((ref) => ref.item === item.key)?.url ?? ''
        return (
          <Row
            item={itemProps}
            density="compact"
            label={item.key}
            {...(model().linearConnected() ? { onPress: () => model().showLinearIssue(item.key) } : { href: url() })}
            leading={<Text emphasis="mono">{item.key}</Text>}
            meta={
              <Show when={summary()?.state}>
                {/* The same visual the linear frame draws. */}
                {(state) => <Chip size="xs" color={state().color}>{state().name}</Chip>}
              </Show>
            }
          >
            <Show
              when={model().linearConnected()}
              fallback={<Text emphasis="muted">Connect Linear to see titles.</Text>}
            >
              <Text emphasis={summary() ? 'body' : 'muted'}>
                {summary()?.label ?? (model().linearIssues.isLoading ? 'Loading…' : '')}
              </Text>
            </Show>
          </Row>
        )
      }}
    </Rows>
  )
}

function Labels(props: { model: PrModel }) {
  const model = () => props.model
  return (
    <Stack>
      <Show when={model().labels().length} fallback={<Text emphasis="muted">None.</Text>}>
        <ChipRow ariaLabel="Labels">
          <For each={model().labels()}>
            {(label) => (
              <Chip
                reveal
                color={label.color ? `#${label.color}` : undefined}
                {...(model().readOnly ? {} : { onRemove: () => model().removeLabel(label.name) })}
              >{label.name}</Chip>
            )}
          </For>
        </ChipRow>
      </Show>
      <Show when={!model().readOnly}>
        <Picker<Label>
          label="Add label…"
          placeholder="Filter labels…"
          emptyText={model().labelsLoading() ? 'Loading labels…' : 'No labels available.'}
          results={model().labelResults}
          rowLabel={(label) => label.name}
          isActive={() => false}
          onSelect={(label) => model().addLabel(label.name)}
        />
      </Show>
    </Stack>
  )
}

function Checks(props: { model: PrModel }) {
  const model = () => props.model
  return (
    <Rows
      id={`gh-checks:${model().scope.number}`}
      ariaLabel="Checks"
      items={model().checks().map((check, index) => ({ key: `${index}:${check.name}`, label: check.name }))}
    >
      {(item, itemProps) => {
        const check = () => model().checks()[Number(item.key.split(':')[0])]
        return (
          <Row
            item={itemProps}
            density="compact"
            label={check()?.name}
            leading={<StatusDot tone={checkStatusTone(check()?.status)} />}
            {...(check()?.runId != null
              ? { onPress: () => model().setOpenCheck({ runId: check()!.runId!, name: check()!.name }) }
              : {})}
            meta={<Text emphasis="muted">{check()?.status}</Text>}
            trailing={
              <Show when={!model().readOnly && FAILED_STATUSES.has((check()?.status ?? '').toLowerCase()) && check()?.runId != null}>
                <Button
                  size="sm"
                  disabled={model().rerunned().has(check()!.runId!)}
                  onPress={() => model().triggerRerun(check()!.runId!)}
                >{model().rerunned().has(check()!.runId!) ? 'Queued' : 'Rerun'}</Button>
              </Show>
            }
          >{check()?.name}</Row>
        )
      }}
    </Rows>
  )
}

function Reviewers(props: { model: PrModel }) {
  const model = () => props.model
  return (
    <Stack>
      <Show when={model().reviewers().length} fallback={<Text emphasis="muted">No reviewers requested.</Text>}>
        <ChipRow ariaLabel="Requested reviewers">
          <For each={model().reviewers()}>
            {(login) => (
              <Chip
                reveal
                leading={<UserAvatar login={login} />}
                {...(model().readOnly ? {} : { onRemove: () => model().removeReviewer(login) })}
              >{login}</Chip>
            )}
          </For>
        </ChipRow>
      </Show>
      <Show when={!model().readOnly}>
        <Picker<string>
          label="Request review…"
          placeholder="Filter people…"
          emptyText={model().mentionsLoading() ? 'Loading people…' : 'No one to request.'}
          results={model().reviewerResults}
          rowLabel={(login) => login}
          isActive={() => false}
          onSelect={(login) => model().requestReviewer(login)}
          leading={(login) => <UserAvatar login={login} />}
        />
      </Show>
    </Stack>
  )
}

/**
 * The pull request's sections, in reading order, for whichever host is drawing them.
 *
 * Rebuilt on every read rather than memoised: the counts come off the model's own queries, and a
 * section list that does not follow them is a tab that says "Checks 0" while the checks are on the
 * screen behind it.
 */
export function prSections(input: {
  model: PrModel
  /** Which file the diff is showing, so the Files section can mark it. */
  currentFile: () => string | undefined
  onOpenFile: (path: string) => void
  onLinkClick: (event: MouseEvent) => void
}): KitSection[] {
  const model = input.model
  return [
    ...(model.pull()?.body ? [{
      id: 'description',
      label: 'Description',
      render: () => <Description model={model} onLinkClick={input.onLinkClick} />,
    }] : []),
    ...(model.linearRefs().length ? [{
      id: 'integrations',
      label: 'Integrations',
      count: model.linearRefs().length,
      render: () => <Integrations model={model} />,
    }] : []),
    { id: 'labels', label: 'Labels', count: model.labels().length, render: () => <Labels model={model} /> },
    ...(model.checks().length ? [{
      id: 'checks',
      label: 'Checks',
      count: model.checks().length,
      meta: () => <StatusDot {...railDotProps(CHECK_TONE[checksState(model.checks())])} />,
      render: () => <Checks model={model} />,
    }] : []),
    { id: 'reviewers', label: 'Reviewers', count: model.reviewers().length, render: () => <Reviewers model={model} /> },
    {
      id: 'files',
      label: 'Files',
      count: model.files().length,
      render: () => <PrFileList model={model} current={input.currentFile} onSelect={input.onOpenFile} />,
    },
    {
      id: 'conversation',
      label: 'Comments/Commits',
      count: model.conversationEntries().length,
      render: () => <PrConversation model={model} onOpenFile={input.onOpenFile} onLinkClick={input.onLinkClick} />,
    },
  ]
}
