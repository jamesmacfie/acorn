import { For, Show } from 'solid-js'
import { clientEvents, railDotProps } from '@acorn/plugin-api/client'
import {
  CHECK_TONE,
  FAILED_STATUSES,
  checkStatusTone,
  checkStatusWord,
  checksState,
  checksSummary,
} from '../model/checkStatus'
import {
  Button,
  Chip,
  ChipRow,
  CopyButton,
  Inline,
  Picker,
  Row,
  Rows,
  Stack,
  StatusDot,
  Text,
  UserAvatar,
  type KitSection,
} from '@acorn/plugin-api/ui'
import { ProviderHtml } from '@acorn/plugin-api/ui/host'
import type { Label } from '../model/types'
import { ChangeRequestConversation } from './Conversation'
import { ChangedFileList } from './FileList'
import type { ChangeRequestModel } from './detailModel'

// What a change request is made of, as a list a host arranges
// (`Sections`, docs/ui-design/closed-kit.md § The closed kit). The list is here once, and each host
// decides what a section is: a fold beside the diff on a desktop, a tab in a terminal.
//
// A section that has nothing to say is left out rather than drawn empty. That is a decision about the
// change request rather than about the screen, which is why it is made here and not in either host: a
// repository with no Linear links has no Linked issues tab, on any host.

// The copy button is the section's action, in its header, and reads the text this body hands the
// model.
function Description(props: { model: ChangeRequestModel; onLinkClick: (event: MouseEvent) => void }) {
  return (
    <ProviderHtml
      html={props.model.request()?.body ?? ''}
      refs={props.model.refPrefixes()}
      onLinkClick={props.onLinkClick}
      onText={props.model.setDescriptionText}
    />
  )
}

function LinkedIssues(props: { model: ChangeRequestModel }) {
  const model = () => props.model
  return (
    <Stack gap="row">
      <Show when={!model().linearConnected()}>
        <Inline gap="row" wrap>
          <Text emphasis="muted">Connect Linear to see these issues' titles.</Text>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}
          >
            Connect Linear
          </Button>
        </Inline>
      </Show>
      <Rows
        id={`cr-integrations:${model().scope.number}`}
        ariaLabel="Linked issues"
        items={model()
          .linearRefs()
          .map((ref) => ({ key: ref.item, label: ref.item }))}
      >
        {(item, itemProps) => {
          const summary = () => model().linearSummary().get(item.key)
          const url = () =>
            model()
              .linearRefs()
              .find((ref) => ref.item === item.key)?.url ?? ''
          return (
            <Row
              item={itemProps}
              density="compact"
              label={item.key}
              {...(model().linearConnected() ? { onPress: () => model().showLinearIssue(item.key) } : { href: url() })}
              {...(model().linearConnected() ? { leading: <Text emphasis="mono">{item.key}</Text> } : {})}
              meta={
                <Show when={summary()?.state}>
                  {/* The same visual the linear frame draws. */}
                  {(state) => (
                    <Chip size="xs" color={state().color}>
                      {state().name}
                    </Chip>
                  )}
                </Show>
              }
            >
              <Show when={model().linearConnected()} fallback={<Text emphasis="mono">{item.key}</Text>}>
                <Text emphasis={summary() ? 'body' : 'muted'}>
                  {summary()?.label ?? (model().linearIssues.isLoading ? 'Loading…' : '')}
                </Text>
              </Show>
            </Row>
          )
        }}
      </Rows>
    </Stack>
  )
}

function Labels(props: { model: ChangeRequestModel }) {
  const model = () => props.model
  return (
    <Stack>
      <Show when={model().labels().length} fallback={<Text emphasis="muted">No labels</Text>}>
        <ChipRow ariaLabel="Labels">
          <For each={model().labels()}>
            {(label) => (
              <Chip
                reveal
                color={label.color ?? undefined}
                {...(model().readOnly ? {} : { onRemove: () => model().removeLabel(label.name) })}
              >
                {label.name}
              </Chip>
            )}
          </For>
        </ChipRow>
      </Show>
      <Show when={!model().readOnly}>
        <Picker<Label>
          size="sm"
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

function Checks(props: { model: ChangeRequestModel }) {
  const model = () => props.model
  return (
    <Rows
      id={`cr-checks:${model().scope.number}`}
      ariaLabel="Checks"
      items={model()
        .checks()
        .map((check, index) => ({ key: `${index}:${check.name}`, label: check.name }))}
    >
      {(item, itemProps) => {
        const check = () => model().checks()[Number(item.key.split(':')[0])]
        return (
          <Row
            item={itemProps}
            density="compact"
            label={check()?.name}
            leading={<StatusDot tone={checkStatusTone(check()?.status)} />}
            {...(check()?.runId != null ? { onPress: () => model().setOpenCheck(check()!) } : {})}
            meta={<Text emphasis="muted">{checkStatusWord(check()?.status)}</Text>}
            trailing={
              <Show
                when={
                  !model().readOnly &&
                  model().actions.rerun &&
                  FAILED_STATUSES.has((check()?.status ?? '').toLowerCase()) &&
                  check()?.runId != null
                }
              >
                <Button
                  size="sm"
                  disabled={model().rerunned().has(check()!.runId!)}
                  onPress={() => model().triggerRerun(check()!.runId!)}
                >
                  {model().rerunned().has(check()!.runId!) ? 'Re-run queued' : 'Re-run'}
                </Button>
              </Show>
            }
          >
            {check()?.name}
          </Row>
        )
      }}
    </Rows>
  )
}

function Reviewers(props: { model: ChangeRequestModel }) {
  const model = () => props.model
  return (
    <Stack>
      <Show when={model().reviewers().length} fallback={<Text emphasis="muted">No reviewers</Text>}>
        <ChipRow ariaLabel="Requested reviewers">
          <For each={model().reviewers()}>
            {(login) => (
              <Chip
                reveal
                leading={<UserAvatar login={login} src={model().host.avatar(login)} />}
                {...(model().readOnly ? {} : { onRemove: () => model().removeReviewer(login) })}
              >
                {login}
              </Chip>
            )}
          </For>
        </ChipRow>
      </Show>
      <Show when={!model().readOnly}>
        <Picker<string>
          size="sm"
          label="Request review…"
          placeholder="Filter people…"
          emptyText={model().mentionsLoading() ? 'Loading people…' : 'No one to request.'}
          results={model().reviewerResults}
          rowLabel={(login) => login}
          isActive={() => false}
          onSelect={(login) => model().requestReviewer(login)}
          leading={(login) => <UserAvatar login={login} src={model().host.avatar(login)} />}
        />
      </Show>
    </Stack>
  )
}

/**
 * The change request's sections, in reading order, for whichever host is drawing them.
 *
 * Rebuilt on every read rather than memoised: the counts come off the model's own queries, and a
 * section list that does not follow them is a tab that says "Checks 0" while the checks are on the
 * screen behind it.
 */
export function changeRequestSections(input: {
  model: ChangeRequestModel
  /** Which file the diff is showing, so the Files section can mark it. */
  currentFile: () => string | undefined
  onOpenFile: (path: string) => void
  onLinkClick: (event: MouseEvent) => void
}): KitSection[] {
  const model = input.model
  return [
    ...(model.request()?.body
      ? [
          {
            id: 'description',
            label: 'Description',
            actions: () => <CopyButton text={model.descriptionText} title="Copy description" />,
            render: () => <Description model={model} onLinkClick={input.onLinkClick} />,
          },
        ]
      : []),
    ...(model.linearRefs().length
      ? [
          {
            id: 'integrations',
            label: 'Linked issues',
            count: model.linearRefs().length,
            render: () => <LinkedIssues model={model} />,
          },
        ]
      : []),
    ...(model.actions.addLabel
      ? [{ id: 'labels', label: 'Labels', count: model.labels().length, render: () => <Labels model={model} /> }]
      : []),
    ...(model.checks().length
      ? [
          {
            id: 'checks',
            label: 'Checks',
            count: model.checks().length,
            meta: () => (
              <StatusDot
                {...railDotProps(CHECK_TONE[checksState(model.checks())])}
                tip={checksSummary(model.checks())}
              />
            ),
            render: () => <Checks model={model} />,
          },
        ]
      : []),
    { id: 'reviewers', label: 'Reviewers', count: model.reviewers().length, render: () => <Reviewers model={model} /> },
    {
      id: 'files',
      label: 'Files',
      count: model.files().length,
      render: () => <ChangedFileList model={model} current={input.currentFile} onSelect={input.onOpenFile} />,
    },
    {
      id: 'conversation',
      label: 'Conversation',
      count: model.conversationEntries().length,
      render: () => (
        <ChangeRequestConversation model={model} onOpenFile={input.onOpenFile} onLinkClick={input.onLinkClick} />
      ),
    },
  ]
}
