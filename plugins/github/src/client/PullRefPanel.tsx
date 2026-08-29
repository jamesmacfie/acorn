import { createMemo, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate } from '@solidjs/router'
import {
  CHECK_TONE, checksState, formatRelativeTime, openInAppUrl, railDotProps, type RefPanelProps,
} from '@acorn/plugin-api/client'
import { Button, EmptyState, Facts, Heading, Inline, Stack, StatusDot, Text, Toolbar } from '@acorn/plugin-api/ui'
import { RefPanelBox, RefPanelTaskLink } from '@acorn/plugin-api/ui/host'
import { parsePullRef } from '../contract/pullRef'
import { pullDetailOptions } from './queries'

// GitHub's reference panel: one pull request, glance-sized, over whatever the reader was looking at
// (docs/github-integration.md § Content links). It shows less than the full pane and offers the pane
// as the next step, rather than being a smaller copy of a whole review.
//
// A tree in the box the host draws. The backdrop, the drawer, the title and the dismiss affordance
// are `RefPanelBox`, the same box a loaded plugin's panel is wrapped in.

export default function PullRefPanel(props: RefPanelProps) {
  const navigate = useNavigate()
  // `owner/repo#number`, parsed by the module that also spells it (../contract/pullRef.ts), so this
  // panel, the collection row, and the URL recogniser name the same thing.
  const parts = createMemo(() => parsePullRef(props.target.displayId))

  const detail = createQuery(() => {
    const at = parts()
    return pullDetailOptions(at?.owner ?? '', at?.repo ?? '', at?.number ?? '', !!at)
  })
  const pull = () => detail.data?.pull
  const checks = () => detail.data?.checks ?? []

  // Through the host's ladder rather than a path built here, so the panel reaches the pull request
  // the way a dashboard row does, including selecting the rail source, which navigating alone does
  // not do. `prefer: 'route'` because this is the "take me there" affordance. An untracked repo has
  // no route, so the URL opens in the browser and the panel is done either way.
  const openFull = (): void => {
    const at = parts()
    if (at) openInAppUrl(`https://github.com/${at.owner}/${at.repo}/pull/${at.number}`, { prefer: 'route', navigate })
    props.onClose()
  }

  return (
    <RefPanelBox
      title={props.target.displayId}
      onClose={props.onClose}
      // Host-drawn and provider-agnostic: whether a task tracks this pull, and how to start one.
      // github never touches core's task routes to offer it.
      footer={<RefPanelTaskLink target={props.target} />}
    >
      <Show
        when={pull()}
        fallback={
          <EmptyState align="start" size="sm" busy={detail.isLoading}>
            {/* A displayId this panel cannot parse means the recogniser and the panel disagree,
                which is a bug, not a missing pull request. Say so instead of spinning. */}
            {!parts() ? 'Not a pull request reference.' : detail.isLoading ? 'Loading…' : 'Could not load this pull request.'}
          </EmptyState>
        }
      >
        {(loaded) => (
          <Stack gap="section">
            <Heading level={3}>{loaded().title}</Heading>
            <Facts
              size="sm"
              items={[
                {
                  label: 'State',
                  value: (
                    <Inline>
                      <StatusDot tone={loaded().draft ? 'muted' : loaded().state === 'open' ? 'ok' : 'accent'} />
                      <Text>{loaded().draft ? 'Draft' : loaded().state}</Text>
                    </Inline>
                  ),
                },
                ...(loaded().author ? [{ label: 'Author', value: <Text>{loaded().author}</Text> }] : []),
                ...(formatRelativeTime(loaded().updatedAt)
                  ? [{ label: 'Updated', value: <Text>{formatRelativeTime(loaded().updatedAt)}</Text> }]
                  : []),
                ...(loaded().headRef
                  ? [{ label: 'Branch', value: <Text>{loaded().headRef} → {loaded().baseRef ?? ''}</Text> }]
                  : []),
                // Checks as one word, not a list. The list is the pane's job.
                ...(checks().length
                  ? [{
                    label: 'Checks',
                    value: (
                      <Inline>
                        <StatusDot {...railDotProps(CHECK_TONE[checksState(checks())])} />
                        <Text>{checks().length} check{checks().length === 1 ? '' : 's'}</Text>
                      </Inline>
                    ),
                  }]
                  : []),
              ]}
            />
            <Toolbar variant="actions">
              <Button onPress={openFull}>Open pull request</Button>
            </Toolbar>
          </Stack>
        )}
      </Show>
    </RefPanelBox>
  )
}
