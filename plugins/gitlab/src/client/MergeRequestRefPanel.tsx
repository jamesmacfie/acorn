import { createMemo, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate } from '@solidjs/router'
import { formatRelativeTime, openInAppUrl, railDotProps, type RefPanelProps } from '@acorn/plugin-api/client'
import { CHECK_TONE, checksState, checksSummary } from '@acorn/change-request-ui/model'
import { Button, EmptyState, Facts, Heading, Inline, Stack, StatusDot, Text, Toolbar } from '@acorn/plugin-api/ui'
import { RefPanelBox, RefPanelTaskLink } from '@acorn/plugin-api/ui/host'
import { mergeRequestUrl, parseMergeRequestRef } from '../shared/mergeRequestRef'
import { mergeRequestOptions } from './queries'

// GitLab's reference panel: one merge request, glance-sized, over whatever the reader was looking at,
// with the pane as the next step.
const STATE_WORD: Record<string, string> = { open: 'Open', closed: 'Closed', merged: 'Merged' }

export default function MergeRequestRefPanel(props: RefPanelProps) {
  const navigate = useNavigate()
  const ref = createMemo(() => parseMergeRequestRef(props.target.displayId))
  const detail = createQuery(() => mergeRequestOptions(ref()?.path ?? '', ref()?.number ?? '', !!ref()))
  const request = () => detail.data?.request
  const checks = () => detail.data?.checks ?? []
  const openFull = () => {
    const at = ref()
    if (at) openInAppUrl(mergeRequestUrl(at.path, at.number), { prefer: 'route', navigate })
    props.onClose()
  }
  return (
    <RefPanelBox
      title={props.target.displayId}
      onClose={props.onClose}
      footer={<RefPanelTaskLink target={props.target} />}
    >
      <Show
        when={request()}
        fallback={
          <EmptyState align="start" size="sm" busy={detail.isLoading}>
            {!ref()
              ? "acorn can't read this merge request link."
              : detail.isLoading
                ? 'Loading…'
                : "Couldn't load this merge request."}
          </EmptyState>
        }
      >
        {(loaded) => (
          <Stack gap="section">
            <Heading level={2}>{loaded().title}</Heading>
            <Facts
              size="sm"
              items={[
                {
                  label: 'State',
                  value: (
                    <Inline>
                      <StatusDot tone={loaded().draft ? 'muted' : loaded().state === 'open' ? 'ok' : 'accent'} />
                      <Text>{loaded().draft ? 'Draft' : STATE_WORD[loaded().state]}</Text>
                    </Inline>
                  ),
                },
                ...(loaded().author ? [{ label: 'Author', value: <Text>{loaded().author}</Text> }] : []),
                ...(formatRelativeTime(loaded().updatedAt)
                  ? [{ label: 'Updated', value: <Text>{formatRelativeTime(loaded().updatedAt)}</Text> }]
                  : []),
                ...(loaded().headRef
                  ? [
                      {
                        label: 'Branch',
                        value: (
                          <Text>
                            {loaded().headRef} → {loaded().baseRef ?? ''}
                          </Text>
                        ),
                      },
                    ]
                  : []),
                ...(checks().length
                  ? [
                      {
                        label: 'Pipeline',
                        value: (
                          <Inline>
                            <StatusDot {...railDotProps(CHECK_TONE[checksState(checks())])} />
                            <Text>{checksSummary(checks())}</Text>
                          </Inline>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            <Toolbar variant="actions">
              <Button onPress={openFull}>Open merge request</Button>
            </Toolbar>
          </Stack>
        )}
      </Show>
    </RefPanelBox>
  )
}
