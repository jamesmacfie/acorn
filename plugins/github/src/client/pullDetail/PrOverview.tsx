import { createMemo, For, Show } from 'solid-js'
import {
  CHECK_TONE, checksState, checksSummary, clientEvents, formatRelativeTime, railDotProps, splitRefTokens,
} from '@acorn/plugin-api/client'
import {
  Alert, Badge, Button, Chip, ConfirmButton, Facts, Heading, Inline, Link, Row, Rows, Select, Stack,
  StatusDot, Text, UserAvatar,
} from '@acorn/plugin-api/ui'
import { Slot } from '@acorn/plugin-api/ui/host'
import { SUMMARY_BADGES_POINT } from '../extensionPoints'
import type { PrModel } from './prModel'

// What this pull request is, what state it is in, and every verb that changes that state.
//
// The header of the surface rather than a section of it, which is why it is not in ./prSections.tsx
// with the rest: a desktop pins it above the folds and a terminal makes it the first tab, and both
// of those are the host's call. What it is not is a fold — the seven that used to be written down the
// middle of this file are in ./prSections.tsx now, one list for both surfaces.
//
// The Solid-rendered twin of the host's `linkifyRefs`: same split, different mechanism, because a
// pull's title is text this component owns and its body is opaque provider HTML. The twin used to
// mint the same raw anchor with the same private class; the kit has a word for a clickable run of
// text now, so it writes a node (docs/ui-design.md § The closed kit).
function RefText(props: { text: string; prefixes: ReadonlyMap<string, string>; onOpen: (id: string) => void }) {
  const parts = createMemo(() => splitRefTokens(props.text, props.prefixes))
  return (
    <For each={parts()}>
      {(part) => part.ref
        ? <Link onPress={() => props.onOpen(part.ref!.item)}>{part.text}</Link>
        : <>{part.text}</>}
    </For>
  )
}

const STATE_WORD = { open: 'Open', draft: 'Draft', closed: 'Closed', merged: 'Merged' } as Record<string, string>

const MERGE_METHODS = [
  { value: 'squash', label: 'Squash and merge' },
  { value: 'merge', label: 'Create a merge commit' },
  { value: 'rebase', label: 'Rebase and merge' },
]
const MERGE_METHOD_WORD: Record<string, string> = { squash: 'squash', merge: 'merge commit', rebase: 'rebase' }

export function PrOverview(props: {
  model: PrModel
  /** Show this file in the diff. The Files tab and the browse diff column resolve it differently, so
   *  the surface that has a router passes its own. */
  onOpenFile: (path: string) => void
  /** A link inside provider HTML. Resolved by the host through the surface's own navigator. */
  onLinkClick: (event: MouseEvent) => void
  /** Leave the number off the title, because a strip above it already names the pull. */
  hideNumber?: boolean
}) {
  const model = () => props.model

  const state = () => {
    const pull = model().pull()
    if (!pull) return 'open'
    return pull.draft ? 'draft' : pull.state
  }
  const stateTone = (): 'ok' | 'accent' | 'neutral' =>
    state() === 'open' ? 'ok' : state() === 'draft' ? 'neutral' : 'accent'

  // Who decided, and how, in one word with the people in its tip. The Reviewers section below lists
  // who was asked; this says what they answered.
  const reviewFact = () => {
    const decision = model().reviewDecision()
    if (decision.state === 'none') return <Text emphasis="muted">No reviews</Text>
    const changes = decision.state === 'changes-requested'
    return (
      <Badge tone={changes ? 'danger' : 'ok'} tip={`${changes ? 'Changes requested by' : 'Approved by'} ${decision.reviewers.join(', ')}`}>
        {changes ? 'Changes requested' : 'Approved'}
      </Badge>
    )
  }
  const checksFact = () => {
    const checks = model().checks()
    if (!checks.length) return <Text emphasis="muted">No checks</Text>
    return (
      <Inline>
        <StatusDot {...railDotProps(CHECK_TONE[checksState(checks)])} />
        <Text>{checksSummary(checks)}</Text>
      </Inline>
    )
  }

  const facts = createMemo(() => {
    const pull = model().pull()
    const age = formatRelativeTime(pull?.updatedAt ?? null)
    return [
      { label: 'State', value: <Badge tone={stateTone()}>{STATE_WORD[state()]}</Badge> },
      ...(pull?.author ? [{ label: 'Author', value: <Chip leading={<UserAvatar login={pull.author} />}>{pull.author}</Chip> }] : []),
      {
        label: 'Branch',
        wide: true,
        value: (
          <Inline>
            <Chip reveal title={pull?.headRef ?? 'head'}>{pull?.headRef ?? 'head'}</Chip>
            <Text emphasis="muted">→</Text>
            <Chip reveal title={pull?.baseRef ?? 'base'}>{pull?.baseRef ?? 'base'}</Chip>
          </Inline>
        ),
      },
      { label: 'Review', value: reviewFact() },
      { label: 'Checks', value: checksFact() },
      ...(age ? [{ label: 'Updated', value: <Text>{age}</Text> }] : []),
    ]
  })

  return (
    <Stack gap="section">
      <Stack>
        <Heading {...(props.hideNumber ? {} : { eyebrow: `#${model().scope.number}` })}>
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

      {/* A related pull is only looked at. Without this the merge box and pickers simply vanished. */}
      <Show when={model().readOnly}>
        <Text emphasis="muted" wrap>Related pull request. Open it from its own task or the pull request list to act on it.</Text>
      </Show>

      {/* Two rows, left-aligned so they do not wrap in the navigator: the one primary for this state,
          then the quieter verbs. A draft cannot merge, so its primary is the way out of draft. */}
      <Show when={!model().readOnly && state() !== 'closed'}>
        <Stack gap="row">
          <Inline gap="row" wrap>
            <Show when={model().pull()?.draft}>
              <Button
                variant="solid"
                disabled={model().draft.isPending}
                onPress={() => model().run(model().draft.mutateAsync(false))}
              >Ready for review</Button>
            </Show>
            <Show when={!model().pull()?.draft && model().pull()?.autoMergeEnabled}>
              <Button
                disabled={model().autoMergeDisable.isPending}
                onPress={() => model().run(model().autoMergeDisable.mutateAsync())}
              >Turn off auto-merge</Button>
              <Text emphasis="muted">Merges on its own when checks pass.</Text>
            </Show>
            {/* A blocked pull keeps the verb it had. "Merge when ready" would turn on auto-merge,
                which fails on a repository that does not allow it, and choosing its primary is a
                product call nobody has made. */}
            <Show when={!model().pull()?.draft && !model().pull()?.autoMergeEnabled && model().pull()?.mergeStateStatus === 'BLOCKED'}>
              <Button
                disabled={model().autoMergeEnable.isPending}
                onPress={() => model().run(model().autoMergeEnable.mutateAsync())}
              >Enable auto-merge ({MERGE_METHOD_WORD[model().mergeMethod()] ?? model().mergeMethod()})</Button>
            </Show>
            <Show when={!model().pull()?.draft && !model().pull()?.autoMergeEnabled && model().pull()?.mergeStateStatus !== 'BLOCKED'}>
              <Button
                variant="solid"
                disabled={model().merge.isPending || model().conflicting()}
                tip={model().conflicting() ? 'Resolve merge conflicts before merging' : undefined}
                onPress={() => model().run(model().merge.mutateAsync())}
              >Merge</Button>
            </Show>
            <Show when={!model().pull()?.draft && !model().pull()?.autoMergeEnabled}>
              <Select
                width="auto"
                label="Merge method"
                value={model().mergeMethod()}
                onChange={(value) => model().setMergeMethod(value)}
                options={MERGE_METHODS}
              />
            </Show>
          </Inline>
          <Inline gap="row" wrap>
            <Show when={!model().pull()?.draft}>
              <Button
                variant="ghost"
                size="sm"
                disabled={model().draft.isPending}
                onPress={() => model().run(model().draft.mutateAsync(true))}
              >Convert to draft</Button>
            </Show>
            {/* Reopen exists, so closing is reversible: arm-to-confirm rather than a dialog. */}
            <ConfirmButton
              variant="ghost"
              size="sm"
              confirmLabel="Close pull request?"
              disabled={model().close.isPending}
              onConfirm={() => model().run(model().close.mutateAsync())}
            >Close</ConfirmButton>
          </Inline>
        </Stack>
      </Show>
      <Show when={!model().readOnly && state() === 'closed'}>
        <Inline gap="row">
          <Button disabled={model().reopen.isPending} onPress={() => model().run(model().reopen.mutateAsync())}>Reopen</Button>
        </Inline>
      </Show>
      <Show when={model().actionError()}>
        {(text) => (
          <Alert
            {...(model().actionNeedsReconnect()
              ? { actions: <Button onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}>Reconnect GitHub</Button> }
              : {})}
          >{text()}</Alert>
        )}
      </Show>

      <Show when={model().conflicting()}>
        <Alert tone="warn" title="This branch has conflicts">
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

    </Stack>
  )
}
