import { createMemo, createSignal, For, Show } from 'solid-js'
import {
  CHECK_TONE, checkStatusTone, checksState, FAILED_STATUSES, formatRelativeTime, railDotProps,
  REF_LINK_CLASS, splitRefTokens,
} from '@acorn/plugin-api/client'
import {
  Alert, Badge, Button, Chip, ChipRow, ConfirmButton, CopyButton, Facts, Fold, Heading, Inline,
  Picker, Row, Rows, Select, Stack, StatusDot, Text, Toolbar, UserAvatar,
} from '@acorn/plugin-api/ui'
import { ProviderHtml, Slot } from '@acorn/plugin-api/ui/host'
import type { Label } from '../../contract/api'
import { SUMMARY_BADGES_POINT } from '../extensionPoints'
import type { PrModel } from './prModel'

// The Overview tab of the pull-request pane, and the top of the browse navigator: what this pull is,
// what state it is in, and every verb that changes that state.
//
// The Solid-rendered twin of the host's `linkifyRefs`: same split, same class, different mechanism,
// because a pull's title is text this component owns and its body is opaque provider HTML.
function RefText(props: { text: string; prefixes: ReadonlyMap<string, string>; onOpen: (id: string) => void }) {
  const parts = createMemo(() => splitRefTokens(props.text, props.prefixes))
  return (
    <For each={parts()}>
      {(part) => part.ref
        ? <a class={REF_LINK_CLASS} onClick={() => props.onOpen(part.ref!.item)}>{part.text}</a>
        : <>{part.text}</>}
    </For>
  )
}

export function PrOverview(props: {
  model: PrModel
  /** Show this file in the diff. The Files tab and the browse diff column resolve it differently, so
   *  the surface that has a router passes its own. */
  onOpenFile: (path: string) => void
  /** A link inside provider HTML. Resolved by the host through the surface's own navigator. */
  onLinkClick: (event: MouseEvent) => void
}) {
  const model = () => props.model
  const [descriptionText, setDescriptionText] = createSignal('')

  const state = () => {
    const pull = model().pull()
    if (!pull) return 'open'
    return pull.draft ? 'draft' : pull.state
  }
  const stateTone = (): 'ok' | 'accent' | 'neutral' =>
    state() === 'open' ? 'ok' : state() === 'draft' ? 'neutral' : 'accent'

  const facts = createMemo(() => {
    const pull = model().pull()
    const summary = model().fileSummary()
    const age = formatRelativeTime(pull?.updatedAt ?? null)
    return [
      { label: 'State', value: <Badge tone={stateTone()}>{state()}</Badge> },
      ...(pull?.author ? [{ label: 'Author', value: <Chip leading={<UserAvatar login={pull.author} />}>{pull.author}</Chip> }] : []),
      {
        label: 'Branch',
        value: (
          <Inline>
            <Chip reveal title={pull?.headRef ?? 'head'}>{pull?.headRef ?? 'head'}</Chip>
            <Text emphasis="muted">→</Text>
            <Chip reveal title={pull?.baseRef ?? 'base'}>{pull?.baseRef ?? 'base'}</Chip>
          </Inline>
        ),
      },
      {
        label: 'Files',
        value: <Text>{summary.count} · +{summary.additions} −{summary.deletions}</Text>,
      },
      ...(age ? [{ label: 'Updated', value: <Text>{age}</Text> }] : []),
      {
        label: 'Reviewers',
        value: model().reviewers().length
          ? <Text>{model().reviewers().join(', ')}</Text>
          : <Text emphasis="muted">none requested</Text>,
      },
    ]
  })

  return (
    <Stack gap="section">
      <Stack>
        <Heading eyebrow={`#${model().scope.number}`}>
          <RefText
            text={model().pull()?.title ?? ''}
            prefixes={model().refPrefixes()}
            onOpen={model().showLinearIssue}
          />
        </Heading>
        <Facts items={facts()} />
        {/* Room for other plugins beside github's own facts: a deploy, a stack, a release train.
            `stack`, so github's own overview stays and a contributor is added to it. */}
        <Slot point={SUMMARY_BADGES_POINT} taskId={model().scope.taskId} props={() => ({
          owner: model().scope.owner,
          repo: model().scope.repo,
          number: model().scope.number,
        })} />
      </Stack>

      <Show when={!model().readOnly && state() !== 'closed'}>
        <Toolbar variant="actions" ariaLabel="Pull request actions">
          <Show when={!model().pull()?.autoMergeEnabled}>
            <Select
              size="sm"
              width="auto"
              label="Merge method"
              value={model().mergeMethod()}
              onChange={(value) => model().setMergeMethod(value)}
              options={[{ value: 'squash', label: 'squash' }, { value: 'merge', label: 'merge' }, { value: 'rebase', label: 'rebase' }]}
            />
          </Show>
          <Show when={model().pull()?.autoMergeEnabled}>
            <Button
              disabled={model().autoMergeDisable.isPending}
              onPress={() => model().run(model().autoMergeDisable.mutateAsync())}
            >Disable auto-merge</Button>
          </Show>
          <Show when={!model().pull()?.autoMergeEnabled && model().pull()?.mergeStateStatus === 'BLOCKED'}>
            <Button
              disabled={model().autoMergeEnable.isPending}
              onPress={() => model().run(model().autoMergeEnable.mutateAsync())}
            >Enable auto-merge ({model().mergeMethod()})</Button>
          </Show>
          <Show when={!model().pull()?.autoMergeEnabled && model().pull()?.mergeStateStatus !== 'BLOCKED'}>
            <Button
              tone="accent"
              disabled={model().merge.isPending || model().conflicting()}
              tip={model().conflicting() ? 'Resolve merge conflicts before merging' : undefined}
              onPress={() => model().run(model().merge.mutateAsync())}
            >Merge</Button>
          </Show>
          {/* Reopen exists, so closing is reversible: arm-to-confirm rather than a dialog. */}
          <ConfirmButton
            confirmLabel="Close?"
            disabled={model().close.isPending}
            onConfirm={() => model().run(model().close.mutateAsync())}
          >Close</ConfirmButton>
          <Button
            disabled={model().draft.isPending}
            onPress={() => model().run(model().draft.mutateAsync(!model().pull()?.draft))}
          >{model().pull()?.draft ? 'Ready for review' : 'Convert to draft'}</Button>
        </Toolbar>
      </Show>
      <Show when={!model().readOnly && state() === 'closed'}>
        <Toolbar variant="actions" ariaLabel="Pull request actions">
          <Button disabled={model().reopen.isPending} onPress={() => model().run(model().reopen.mutateAsync())}>Reopen</Button>
        </Toolbar>
      </Show>
      <Show when={model().actionError()}>{(text) => <Alert>{text()}</Alert>}</Show>

      <Show when={model().conflicting()}>
        <Alert tone="warn" title="Merge conflicts">
          <Show
            when={model().conflicts()?.available}
            fallback={model().conflictsLoading()
              ? 'Checking for conflicting files…'
              : 'Map this repository to a local checkout to list the conflicting files.'}
          >
            <Rows id={`gh-conflicts:${model().scope.number}`} ariaLabel="Conflicting files" items={model().conflicts()!.files.map((path) => ({ key: path, label: path }))}>
              {(item, itemProps) => (
                <Row item={itemProps} density="compact" onPress={() => props.onOpenFile(item.key)} label={item.key}
                  leading={<Badge size="xs" tone="warn">!</Badge>}
                >{item.key}</Row>
              )}
            </Rows>
          </Show>
        </Alert>
      </Show>

      <Show when={model().pull()?.body}>
        {(body) => (
          <Fold
            persistKey="description"
            defaultOpen
            label="Description"
            actions={<CopyButton text={descriptionText} title="Copy description" />}
          >
            <ProviderHtml
              html={body()}
              refs={model().refPrefixes()}
              onLinkClick={props.onLinkClick}
              onText={setDescriptionText}
            />
          </Fold>
        )}
      </Show>

      <Show when={model().linearRefs().length}>
        <Fold persistKey="integrations" defaultOpen label="Integrations" count={model().linearRefs().length}>
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
        </Fold>
      </Show>

      <Fold persistKey="labels" defaultOpen label="Labels" count={model().labels().length}>
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
      </Fold>

      <Show when={model().checks().length}>
        <Fold
          persistKey="checks"
          label="Checks"
          count={model().checks().length}
          meta={<StatusDot {...railDotProps(CHECK_TONE[checksState(model().checks())])} />}
        >
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
        </Fold>
      </Show>

      <Fold persistKey="reviewers" defaultOpen label="Reviewers" count={model().reviewers().length}>
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
      </Fold>
    </Stack>
  )
}
