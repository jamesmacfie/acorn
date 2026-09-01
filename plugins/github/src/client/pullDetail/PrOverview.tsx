import { createMemo, For, Show } from 'solid-js'
import { formatRelativeTime, splitRefTokens } from '@acorn/plugin-api/client'
import {
  Alert, Badge, Button, Chip, ConfirmButton, Facts, Heading, Inline, Link, Row, Rows, Select, Stack,
  Text, Toolbar, UserAvatar,
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

export function PrOverview(props: {
  model: PrModel
  /** Show this file in the diff. The Files tab and the browse diff column resolve it differently, so
   *  the surface that has a router passes its own. */
  onOpenFile: (path: string) => void
  /** A link inside provider HTML. Resolved by the host through the surface's own navigator. */
  onLinkClick: (event: MouseEvent) => void
}) {
  const model = () => props.model

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

    </Stack>
  )
}
